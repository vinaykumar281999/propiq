"""AI property advisor powered by Claude."""
import json
from typing import Generator

import anthropic

MODEL = "claude-opus-4-8"

SYSTEM_PROMPT = """You are PropIQ, an expert real estate investment advisor.
You help users understand property investment opportunities, analyze ROI,
compare neighborhoods, and make informed portfolio decisions.
Use the data provided to give specific, data-driven answers.
Keep responses concise and actionable."""


def _client() -> anthropic.Anthropic:
    return anthropic.Anthropic()


def ask(question: str, context: str | None = None) -> str:
    """Single-turn Q&A about property investments."""
    messages: list[dict] = []
    if context:
        messages.append({"role": "user", "content": f"Context:\n{context}"})
        messages.append({"role": "assistant", "content": "Understood. I have the property data context."})
    messages.append({"role": "user", "content": question})

    response = _client().messages.create(
        model=MODEL,
        max_tokens=1024,
        thinking={"type": "adaptive"},
        system=SYSTEM_PROMPT,
        messages=messages,
    )

    for block in response.content:
        if block.type == "text":
            return block.text
    return ""


def stream_ask(question: str, context: str | None = None) -> Generator[str, None, None]:
    """Streaming version of ask() — yields text chunks."""
    messages: list[dict] = []
    if context:
        messages.append({"role": "user", "content": f"Context:\n{context}"})
        messages.append({"role": "assistant", "content": "Understood. I have the property data context."})
    messages.append({"role": "user", "content": question})

    with _client().messages.stream(
        model=MODEL,
        max_tokens=2048,
        thinking={"type": "adaptive"},
        system=SYSTEM_PROMPT,
        messages=messages,
    ) as stream:
        for event in stream:
            if (
                event.type == "content_block_delta"
                and event.delta.type == "text_delta"
            ):
                yield event.delta.text


def analyze_portfolio(properties: list[dict], budget: int) -> str:
    """Ask Claude to analyze a list of properties within a budget."""
    props_json = json.dumps(properties, indent=2)
    context = f"Available properties:\n{props_json}\n\nInvestment budget: ${budget:,}"
    question = (
        "Given these properties and the budget, which would you recommend for "
        "maximum ROI? Highlight the top picks and explain the trade-offs."
    )
    return ask(question, context)
