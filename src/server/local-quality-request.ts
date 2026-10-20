import 'server-only';
import { verifiedLocalQualityRequest } from './local-quality-boundary.mjs';

/** An ordinary Next server has no attested request context and always returns false. */
export const hasVerifiedLocalQualityBoundary = () => verifiedLocalQualityRequest();
