/**
 * 「小川」语音会话状态机(docs/jarvis-voice-mode-plan.md §4)。
 *
 * 纯 reducer:不碰时钟、不碰 DOM、不发请求。所有事件都带 `at`
 * (performance.now() 域的毫秒数),由调用方(回放器 / 8b 编排服务)注入,
 * 这样单测可以精确推演「3s 超时」「8s 思考超时」而不依赖真实等待。
 *
 * 超时不在 reducer 内部判定:导出 followupRemaining / thinkingExpired
 * 两个纯判定,驱动层每帧(或低频轮询)检查后再派发超时事件。
 */

/** 规格时钟(plan §4/§5/§7):唤醒成型 / 思考上限 / 追问倒计时 / 退场 / 卡片吸回。 */
export const VOICE_TIMING = {
  wakingMs: 900,
  thinkingMaxMs: 8000,
  followupMs: 3000,
  closingMs: 800,
  foldMs: 200, // §5 退场第一步:答案卡折叠吸回核心
} as const;

export type VoiceStateName =
  | "ambient" // 常态:工业基线轮播,覆盖层不存在
  | "waking" // 大屏淡出,粒子场成型(~900ms)
  | "listening" // 核心随振幅呼吸,收集提问
  | "thinking" // 自转加速、粒子内收,琥珀火花上飘
  | "answering" // 粒子中心发射答案卡,关键数字随播报高亮
  | "followup" // 卡片保持,外圈能量环 3s 递减
  | "closing" // 卡片折叠吸回 → 粒子散场 → 基线淡回(~800ms)
  | "error-fallback"; // 任意状态出错:播报降级话术后退场

/** 答案卡数据。8a 只做 target-progress 一个模板;
 * 字段一律是「工具返回的格式化字符串」(plan §7 数据一致性红线),
 * 8a 阶段由 mock 口径(target.ts)生成,8b 起由注入 payload 生成。
 *
 * 8b 起补齐 plan §7 模板库(kind 与模板一一对应,组件侧经注册表分发):
 * - region               区域对比卡(数据=delivery.routes 聚合)
 * - completion-ring      完成率环卡(数据=collection.targetRate/remainingAmount)
 * - customers-shipments  客户/发货卡(数据=delivery.milestones+reminders)
 * - brief                结论卡(tool.invoke 不带数据模板时的兜底承载,
 *                        只呈现播报结论,不承载任何独立数字口径)
 * 每个成员都必须带 spoken:它是播报文案,也是卡内打字机的正文。 */
export type AnswerCardData =
  | {
      kind: "target-progress";
      title: string;
      actualText: string;
      targetText: string;
      remainingText: string;
      completionRate: number;
      spoken: string;
    }
  | {
      kind: "completion-ring";
      title: string;
      /** 环读数(0..100,已在构造处钳制) */
      ratePercent: number;
      collectedText: string;
      targetText: string;
      remainingText: string;
      spoken: string;
    }
  | {
      kind: "region";
      title: string;
      summaryText: string;
      rows: Array<{
        region: string;
        shipments: number;
        units: number;
        /** 占总台数百分比(0..100,一位小数) */
        sharePercent: number;
      }>;
      spoken: string;
    }
  | {
      kind: "customers-shipments";
      title: string;
      summaryText: string;
      rows: Array<{
        equipmentText: string;
        detailText: string;
        statusText: string;
        dateLabel: string;
      }>;
      spoken: string;
    }
  | {
      kind: "brief";
      title: string;
      /** 结论要点(每条一句话;数字均来自注入口径) */
      lines: string[];
      spoken: string;
    };

export type VoiceSessionState = {
  name: VoiceStateName;
  /** 进入当前状态的时刻(ms)。自环事件(PARTIAL)不刷新。 */
  since: number;
  /** 完成的接管次数(closing→ambient 计一),回放器用它轮换演示剧本。 */
  cycles: number;
  /** 本轮接管内完成的问答轮数(followup 再开口不加 waking 直入 listening)。 */
  turns: number;
  /** ASR 中间转写(listening 期间核心上方小字)。 */
  partial: string | null;
  /** 静音判定后的最终问题。 */
  question: string | null;
  /** 当前展示中的答案卡(answering/followup 持有;打断/退场即回收)。 */
  card: AnswerCardData | null;
  /** 当前播报文案(答案卡结论 / 追问 / 告别,由派发方携带)。 */
  spoken: string | null;
  error: string | null;
};

export type VoiceEvent =
  | { type: "WAKE"; at: number } // 唤醒词命中(或 F9 运维后备)
  | { type: "WOKEN"; at: number } // waking 成型动画结束(~900ms)
  | { type: "PARTIAL"; at: number; text: string } // ASR 中间结果(自环)
  | { type: "SUBMIT"; at: number; question: string } // VAD 静音判定 → thinking
  | { type: "THINKING_VOICE"; at: number } // thinking 中再开口 → 回 listening(§4 ⇄)
  | { type: "ANSWER"; at: number; card: AnswerCardData } // 结果就绪,发射答案卡
  | { type: "SPOKEN"; at: number } // 播报完成 → followup
  | { type: "BARGE_IN"; at: number } // answering 打断(8c 实装,状态机先行支持)
  | { type: "SPEAK"; at: number } // followup 再开口 → listening(旧卡折叠回收)
  | { type: "DECLINE"; at: number } // 「没有了/谢谢」→ 直接退场
  | { type: "FOLLOWUP_TIMEOUT"; at: number } // 追问 3s 无输入 → closing
  | { type: "THINK_TIMEOUT"; at: number } // thinking 超 8s → 降级
  | { type: "FORCE_CLOSE"; at: number } // 运维(Esc):任何会话态立即退场
  | { type: "CLOSED"; at: number } // 退场动画结束 → ambient
  | { type: "ERROR"; at: number; message: string } // 任意会话态出错 → 降级话术
  | { type: "ERROR_SPOKEN"; at: number }; // 降级话术播完 → closing

/** 去掉 at 的事件(Omit 对联合不分布,须显式分发;live-source 映射用)。 */
export type VoiceEventInput<T = VoiceEvent> = T extends unknown ? Omit<T, "at"> : never;

export function initSessionState(now = 0): VoiceSessionState {
  return {
    name: "ambient",
    since: now,
    cycles: 0,
    turns: 0,
    partial: null,
    question: null,
    card: null,
    spoken: null,
    error: null,
  };
}

/**
 * 全函数 reducer:任何 (state, event) 组合都返回合法状态,
 * 非法转移原样返回(覆盖层不存在的状态绝不能被误事件唤醒)。
 *
 * 两个刻意的例外(plan §4「任意状态出错」的边界):
 * - ambient 收到 ERROR 不接管屏幕(没有会话就没有可降级的会话);
 * - closing 收到 ERROR 不中断退场——退场必须走完,基线永远能回来。
 */
export function sessionReducer(state: VoiceSessionState, event: VoiceEvent): VoiceSessionState {
  const at = event.at;
  switch (event.type) {
    case "WAKE":
      if (state.name !== "ambient") return state;
      return { ...initSessionState(at), cycles: state.cycles, name: "waking", since: at };

    case "WOKEN":
      if (state.name !== "waking") return state;
      return { ...state, name: "listening", since: at };

    case "PARTIAL":
      if (state.name !== "listening") return state;
      return { ...state, partial: event.text }; // 自环:since 不变,呼吸相位连续

    case "SUBMIT":
      if (state.name !== "listening") return state;
      return { ...state, name: "thinking", since: at, question: event.question, partial: null };

    case "THINKING_VOICE":
      if (state.name !== "thinking") return state;
      return { ...state, name: "listening", since: at, partial: null };

    case "ANSWER":
      if (state.name !== "thinking") return state;
      return {
        ...state,
        name: "answering",
        since: at,
        card: event.card,
        spoken: event.card.spoken,
        turns: state.turns + 1,
      };

    case "SPOKEN":
      if (state.name !== "answering") return state;
      return { ...state, name: "followup", since: at };

    case "BARGE_IN":
      if (state.name !== "answering") return state;
      return { ...state, name: "listening", since: at, card: null, spoken: null, partial: null };

    case "SPEAK":
      if (state.name !== "followup") return state;
      return { ...state, name: "listening", since: at, card: null, spoken: null, partial: null };

    case "DECLINE":
    case "FOLLOWUP_TIMEOUT":
      if (state.name !== "followup") return state;
      return { ...state, name: "closing", since: at };

    case "THINK_TIMEOUT":
      if (state.name !== "thinking") return state;
      return { ...state, name: "error-fallback", since: at, error: "thinking-timeout", card: null, spoken: null };

    case "ERROR":
      if (state.name === "ambient" || state.name === "closing" || state.name === "error-fallback") {
        return state;
      }
      return { ...state, name: "error-fallback", since: at, error: event.message, card: null, spoken: null };

    case "ERROR_SPOKEN":
      if (state.name !== "error-fallback") return state;
      return { ...state, name: "closing", since: at };

    case "FORCE_CLOSE":
      if (state.name === "ambient" || state.name === "closing") return state;
      return { ...state, name: "closing", since: at, card: null, spoken: null, partial: null };

    case "CLOSED":
      if (state.name !== "closing") return state;
      return { ...initSessionState(at), cycles: state.cycles + 1 };
  }
}

/** followup 剩余毫秒(能量环倒计时);非 followup 返回 null。 */
export function followupRemaining(
  state: VoiceSessionState,
  now: number,
  followupMs: number = VOICE_TIMING.followupMs,
): number | null {
  if (state.name !== "followup") return null;
  return Math.max(0, state.since + followupMs - now);
}

/** thinking 是否已超时(驱动层据此派发 THINK_TIMEOUT)。 */
export function thinkingExpired(
  state: VoiceSessionState,
  now: number,
  thinkingMaxMs: number = VOICE_TIMING.thinkingMaxMs,
): boolean {
  return state.name === "thinking" && now - state.since >= thinkingMaxMs;
}

/** 覆盖层是否应当存在(基线可见 = false,基线零开销的判定点)。 */
export function isSessionActive(state: VoiceSessionState): boolean {
  return state.name !== "ambient";
}
