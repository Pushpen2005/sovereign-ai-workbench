export function createInspectionResult(findings = []) {
    if (!Array.isArray(findings)) {
        throw new TypeError("findings must be an array");
    }

    return {
        findings,
    };
}