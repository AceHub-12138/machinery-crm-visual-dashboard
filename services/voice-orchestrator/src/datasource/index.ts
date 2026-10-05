/**
 * 数据源适配层入口(plan §16.2 B①)。
 *
 * 大屏与语音共用一份口径:8b 本仓阶段读本地 fixture(字段结构与平台
 * PublicSalesScreenPayload 逐字段对齐);迁移平台 = 配置改成 http 模式,
 * 只换 URL + publicId 两个值,本层接口与上游零改动。
 */

import { readFile } from "node:fs/promises";
import { validatePublicPayload, type PublicSalesScreenPayload } from "../../../../src/lib/voice/public-payload.ts";

export type DataSourceError = Error & { code: "datasource"; status?: number };

export function dataSourceError(message: string, status?: number): DataSourceError {
  const err = new Error(message) as DataSourceError;
  err.code = "datasource";
  err.status = status;
  return err;
}

export interface SalesScreenDataSource {
  readonly name: string;
  fetchPayload(signal?: AbortSignal): Promise<PublicSalesScreenPayload>;
}

/** 本地 fixture 源(8b 默认;文件只读)。
 * 注意:编排服务 TS 直跑(strip-types),类字段必须显式声明,不能用
 * constructor 参数属性——下同。 */
export class FixturePayloadSource implements SalesScreenDataSource {
  readonly name = "fixture";
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async fetchPayload(): Promise<PublicSalesScreenPayload> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (err) {
      throw dataSourceError(`fixture 读取失败: ${(err as Error).message}`);
    }
    try {
      return validatePublicPayload(JSON.parse(raw));
    } catch (err) {
      if ((err as DataSourceError).code === "datasource") throw err;
      throw dataSourceError(`fixture 解析失败: ${(err as Error).message}`);
    }
  }
}

/** 平台 HTTP 源(GET {url}/api/screen/sales/{publicId};迁移即换两个配置值)。 */
export class HttpPayloadSource implements SalesScreenDataSource {
  readonly name = "http";
  private readonly baseUrl: string;
  private readonly publicId: string;
  private readonly fetchImpl: typeof fetch;

  constructor(baseUrl: string, publicId: string, fetchImpl: typeof fetch = fetch) {
    this.baseUrl = baseUrl;
    this.publicId = publicId;
    this.fetchImpl = fetchImpl;
  }

  async fetchPayload(signal?: AbortSignal): Promise<PublicSalesScreenPayload> {
    const url = `${this.baseUrl.replace(/\/+$/, "")}/api/screen/sales/${encodeURIComponent(this.publicId)}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        signal,
        cache: "no-store",
        headers: { accept: "application/json" },
      });
    } catch (err) {
      throw dataSourceError(`payload 请求失败: ${(err as Error).message}`);
    }
    if (!response.ok) {
      throw dataSourceError(`payload 响应异常: HTTP ${response.status}`, response.status);
    }
    try {
      return validatePublicPayload(await response.json());
    } catch (err) {
      if ((err as DataSourceError).code === "datasource") throw err;
      throw dataSourceError(`payload 解析失败: ${(err as Error).message}`);
    }
  }
}

export function createDataSource(options: {
  mode: "fixture" | "http";
  fixturePath: string;
  baseUrl: string;
  publicId: string;
  fetchImpl?: typeof fetch;
}): SalesScreenDataSource {
  if (options.mode === "http") {
    if (!options.baseUrl || !options.publicId) {
      throw dataSourceError("http 模式需要 VOICE_PAYLOAD_URL 与 VOICE_PAYLOAD_PUBLIC_ID");
    }
    return new HttpPayloadSource(options.baseUrl, options.publicId, options.fetchImpl);
  }
  return new FixturePayloadSource(options.fixturePath);
}
