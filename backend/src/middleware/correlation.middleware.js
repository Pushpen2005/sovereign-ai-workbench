import { randomUUID } from "crypto";

export function correlationMiddleware(req, res, next) {
    const correlationId = req.headers["x-request-id"] || req.headers["x-correlation-id"] || randomUUID();
    req.correlationId = correlationId;
    res.setHeader("X-Request-Id", correlationId);
    next();
}
