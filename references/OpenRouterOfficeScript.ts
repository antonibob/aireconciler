/**
 * Office Script: OpenRouter Chat Completion
 * 
 * Setup:
 * 1. In Excel (Web or Desktop): Automate tab → New Script
 * 2. Paste this code
 * 3. Set your API key in the script settings (gear icon → Script settings → Parameters)
 *    Or edit the DEFAULT_API_KEY constant below
 * 4. Add a button: Insert → Shapes → pick shape → right-click → Assign Script → main
 * 
 * Usage:
 * - Select a cell with your prompt, run script → writes response to adjacent cell
 * - Or run from button, uses hardcoded prompt/model for testing
 */

// ============ CONFIG ============
// Option A: Set via Script Parameters (Automate → Script settings → Parameters)
//   Add parameter: apiKey (string, required)
// Option B: Hardcode here (not for sharing)
const DEFAULT_API_KEY = ""; // e.g., "sk-or-xxxx"
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "nvidia/nemotron-3.5-lightning"; // FREE
const APP_NAME = "Excel-OfficeScript";
const APP_URL = "https://github.com/NousResearch/hermes-agent";

// ============ MAIN ============
async function main(workbook: ExcelScript.Workbook) {
  // Get API key: parameter > constant > error
  let apiKey = DEFAULT_API_KEY;
  try {
    // @ts-ignore - script parameters are injected at runtime
    if (typeof apiKeyParam === "string" && apiKeyParam.length > 0) {
      apiKey = apiKeyParam;
    }
  } catch { }

  if (!apiKey || apiKey === "YOUR_OPENROUTER_KEY_HERE") {
    await workbook.getActiveWorksheet().getRange("A1").setValue("❌ No API key. Set in Script Parameters or edit DEFAULT_API_KEY.");
    return;
  }

  // Get prompt from selection (or use test prompt)
  const selection = workbook.getSelectedRange();
  let prompt = selection.getValues()[0][0] as string;
  if (!prompt || typeof prompt !== "string" || prompt.trim() === "") {
    prompt = "Say 'connected' in 3 words"; // test prompt
  }

  // Model (could also come from a named cell/parameter)
  const model = DEFAULT_MODEL;

  // Call API
  const result = await callOpenRouter(apiKey, prompt, model);

  // Write result next to prompt (or to a specific range)
  const outputRange = selection.getOffsetRange(0, 1).getResizedRange(0, 0);
  outputRange.setValue(result);
  outputRange.setNumberFormat("@"); // text format
  outputRange.getFormat().getWrapText()?.setValue(true);
  outputRange.getFormat().getColumnWidth()?.setValue(60);
}

// ============ API CALL ============
async function callOpenRouter(apiKey: string, prompt: string, model: string): Promise<string> {
  const payload = {
    model,
    messages: [
      { role: "system", content: "You are a helpful assistant embedded in Excel. Be concise. Return only the answer — no markdown unless asked." },
      { role: "user", content: prompt }
    ],
    temperature: 0.3,
    max_tokens: 2000
  };

  try {
    const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": APP_URL,
        "X-Title": APP_NAME
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      return `❌ HTTP ${response.status}: ${errText}`;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    return content?.trim() ?? "❌ Empty response";
  } catch (err: any) {
    return `❌ Network error: ${err.message}`;
  }
}

// ============ HELPER: List Models (run separately) ============
/*
async function listModels(workbook: ExcelScript.Workbook) {
  let apiKey = DEFAULT_API_KEY;
  try { if (typeof apiKeyParam === "string") apiKey = apiKeyParam; } catch { }
  if (!apiKey) { await workbook.getActiveWorksheet().getRange("A1").setValue("❌ No API key"); return; }

  const response = await fetch(`${OPENROUTER_BASE_URL}/models`, {
    headers: { "Authorization": `Bearer ${apiKey}` }
  });
  if (!response.ok) { return; }
  const data = await response.json();
  const models = (data.data || []).map((m: any) => m.id).sort();
  
  const sheet = workbook.getActiveWorksheet();
  const range = sheet.getRange("A1").getResizedRange(models.length - 1, 0);
  range.setValues(models.map(m => [m]));
}
*/