"""OpenRouter chat calls with token and dollar accounting. Stub mode returns deterministic fake output."""
import os
import re
import time

from openai import OpenAI

from .config import env

_client: OpenAI | None = None
STUB = os.environ.get("SKILLSMITH_STUB_LLM", "0") == "1"


def client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=env("OPENROUTER_API_KEY"),
                         default_headers={"X-Title": "Skill Smith"})
    return _client


def chat(model: str, system: str, user: str, temperature: float = 0.2, max_tokens: int = 2000,
         stub: str | None = None) -> dict:
    """Returns {"text", "model", "tokens_in", "tokens_out", "cost_usd", "latency_s"}."""
    if STUB and stub is not None:
        return {"text": stub, "model": "stub", "tokens_in": 0, "tokens_out": 0, "cost_usd": 0.0, "latency_s": 0.0}
    t0 = time.time()
    last_err = None
    for attempt in range(4):
        try:
            resp = client().chat.completions.create(
                model=model, temperature=temperature, max_tokens=max_tokens,
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                extra_body={"usage": {"include": True}},
            )
            u = resp.usage
            cost = getattr(u, "cost", None)
            if cost is None and getattr(u, "model_extra", None):
                cost = u.model_extra.get("cost")
            return {"text": resp.choices[0].message.content or "", "model": resp.model or model,
                    "tokens_in": u.prompt_tokens, "tokens_out": u.completion_tokens,
                    "cost_usd": float(cost or 0.0), "latency_s": round(time.time() - t0, 2)}
        except Exception as e:  # rate limits and transient network errors
            last_err = e
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"LLM call failed after retries: {last_err}")


def extract_code(text: str) -> str:
    m = re.search(r"```(?:python)?\s*\n(.*?)```", text, re.S)
    if m:
        return m.group(1).strip()
    m = re.search(r"```(?:python)?\s*\n(.*)", text, re.S)  # unterminated fence: keep what's after it
    return (m.group(1) if m else text).strip()


def extract_json(text: str) -> str:
    m = re.search(r"```(?:json)?\s*\n(.*?)```", text, re.S)
    if m:
        return m.group(1).strip()
    start, end = text.find("{"), text.rfind("}")
    return text[start:end + 1] if start >= 0 else text
