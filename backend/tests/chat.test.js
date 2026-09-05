import assert from "node:assert";
import app from "../src/app.js";

async function runChatTests() {
  console.log("==============================================");
  console.log("PR #20 — Chat Persistence & History Test Suite");
  console.log("==============================================\n");

  const server = app.listen(0);
  const port = server.address().port;
  const BASE_URL = process.env.TEST_BASE_URL || `http://127.0.0.1:${port}`;

  try {
    // Authenticate demo user for protected chat endpoints
    const loginRes = await fetch(`${BASE_URL}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: process.env.DEMO_USER_EMAIL || "engineer@example.com",
        password: process.env.DEMO_USER_PASSWORD || "DemoPassword123!",
      }),
    });
    const loginData = await loginRes.json();
    const token = loginData.data?.token;
    const authHeaders = { Authorization: `Bearer ${token}` };

    // 1. Initial history and stats check
    console.log("[1] Checking initial chat history and stats...");
    const initHistRes = await fetch(`${BASE_URL}/api/v1/chat/history`, { headers: authHeaders });
    assert.equal(initHistRes.status, 200);
    const initHistData = await initHistRes.json();
    const startConvCount = initHistData.data.length;

    const initStatsRes = await fetch(`${BASE_URL}/api/v1/chat/stats`, { headers: authHeaders });
    assert.equal(initStatsRes.status, 200);
    const initStatsData = await initStatsRes.json();
    const startQueryCount = initStatsData.data.queries;
    console.log(`    ✓ Initial conversations: ${startConvCount}, initial queries: ${startQueryCount}`);

    // 2. Ask first question (creates new conversation)
    console.log("\n[2] Asking first question (auto-create conversation)...");
    const q1 = "What is the normal operating limit for bearing temperature?";
    const ask1Res = await fetch(`${BASE_URL}/api/v1/chat/ask`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ question: q1 }),
    });
    assert.equal(ask1Res.status, 200);
    const ask1Data = await ask1Res.json();
    assert.equal(ask1Data.success, true);
    assert.ok(ask1Data.conversationId, "conversationId must be returned");
    assert.ok(ask1Data.answer, "answer must be returned");
    assert.ok(Array.isArray(ask1Data.sources), "sources must be returned");
    const convId = ask1Data.conversationId;
    console.log(`    ✓ First question succeeded. Conversation ID: ${convId}`);
    console.log(`    ✓ Answer received: "${ask1Data.answer.slice(0, 60)}..."`);
    console.log(`    ✓ Sources returned: ${ask1Data.sources.length}`);

    // 3. Ask second question in same conversation
    console.log(`\n[3] Asking second question within conversation: ${convId}...`);
    const q2 = "What should be done if temperature exceeds the limit?";
    const ask2Res = await fetch(`${BASE_URL}/api/v1/chat/ask`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ question: q2, conversationId: convId }),
    });
    assert.equal(ask2Res.status, 200);
    const ask2Data = await ask2Res.json();
    assert.equal(ask2Data.success, true);
    assert.equal(ask2Data.conversationId, convId, "Must attach to existing conversation");
    console.log("    ✓ Second question succeeded within same conversation");

    // 4. Verify conversation messages
    console.log(`\n[4] Verifying GET /api/v1/chat/conversations/${convId}/messages...`);
    const msgRes = await fetch(`${BASE_URL}/api/v1/chat/conversations/${convId}/messages`, { headers: authHeaders });
    assert.equal(msgRes.status, 200);
    const msgData = await msgRes.json();
    assert.equal(msgData.success, true);
    assert.equal(msgData.data.length, 4, "Must have 4 messages (2 exchanges)");

    assert.equal(msgData.data[0].role, "user");
    assert.equal(msgData.data[0].content, q1);
    assert.equal(msgData.data[1].role, "assistant");
    assert.ok(msgData.data[1].content.length > 0);

    assert.equal(msgData.data[2].role, "user");
    assert.equal(msgData.data[2].content, q2);
    assert.equal(msgData.data[3].role, "assistant");
    assert.ok(msgData.data[3].content.length > 0);
    console.log("    ✓ Messages correctly ordered (oldest to newest) with persisted sources");

    // 5. Verify conversation appears in history
    console.log("\n[5] Verifying conversation in GET /api/v1/chat/history...");
    const histRes = await fetch(`${BASE_URL}/api/v1/chat/history`, { headers: authHeaders });
    assert.equal(histRes.status, 200);
    const histData = await histRes.json();
    assert.equal(histData.data.length, startConvCount + 1, "Conversations must increment by 1");
    const targetConv = histData.data.find((c) => c.id === convId);
    assert.ok(targetConv, "Target conversation must be in history list");
    assert.equal(targetConv.messageCount, 4, "messageCount must be 4");
    console.log(`    ✓ History confirmed: title="${targetConv.title}", messages=${targetConv.messageCount}`);

    // 6. Verify stats endpoint reflects queries
    console.log("\n[6] Verifying GET /api/v1/chat/stats...");
    const statsRes = await fetch(`${BASE_URL}/api/v1/chat/stats`, { headers: authHeaders });
    assert.equal(statsRes.status, 200);
    const statsData = await statsRes.json();
    assert.equal(statsData.data.queries, startQueryCount + 2, "Query count must increment by exactly 2");
    assert.equal(statsData.data.conversations, startConvCount + 1);
    console.log(`    ✓ Stats confirmed: total queries=${statsData.data.queries}`);

    // 7. Organization isolation
    console.log("\n[7] Verifying organization isolation...");
    const foreignOrgRes = await fetch(`${BASE_URL}/api/v1/chat/conversations/${convId}/messages`, {
      headers: { ...authHeaders, "x-organization-id": "00000000-0000-0000-0000-999999999999" },
    });
    assert.ok([403, 404].includes(foreignOrgRes.status), "Foreign organization header must be blocked with 403/404");

    const foreignHistRes = await fetch(`${BASE_URL}/api/v1/chat/history`, {
      headers: { ...authHeaders, "x-organization-id": "00000000-0000-0000-0000-999999999999" },
    });
    if (foreignHistRes.status === 200) {
      const foreignHistData = await foreignHistRes.json();
      const leakedConv = foreignHistData.data?.find((c) => c.id === convId);
      assert.strictEqual(leakedConv, undefined, "Foreign organization must not see conversation in history");
    } else {
      assert.ok([403, 404].includes(foreignHistRes.status), "Foreign organization access denied");
    }
    console.log("    ✓ Organization isolation confirmed");

    // 8. Negative test: non-existent conversation in ask
    console.log("\n[8] Verifying ask with invalid conversationId...");
    const badAskRes = await fetch(`${BASE_URL}/api/v1/chat/ask`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        question: "Hello?",
        conversationId: "00000000-0000-0000-0000-000000000000",
      }),
    });
    assert.equal(badAskRes.status, 404, "Unknown conversationId must return 404");
    console.log("    ✓ Handled unknown conversationId with 404");

    console.log("\n==============================================");
    console.log("✅ ALL PR #20 CHAT PERSISTENCE TESTS PASSED");
    console.log("==============================================\n");
  } finally {
    server.close();
  }
}

runChatTests().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error("Chat persistence test failed:", err);
  process.exit(1);
});
