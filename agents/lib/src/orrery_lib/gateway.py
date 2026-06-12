"""LiteLLM gateway client.

All Orrery agents talk to Anthropic through the LiteLLM proxy, which
speaks the OpenAI chat-completions shape. This factors the model
construction into one place: the gateway URL, the model alias, and the
(unauthenticated, Phase-0) provider config live here, not in each agent.
"""
from __future__ import annotations

import os

from pydantic_ai.models.openai import OpenAIModel
from pydantic_ai.providers.openai import OpenAIProvider

# In-cluster default (the compose service is named `gateway`). Override
# with ORRERY_GATEWAY_URL for local-host testing.
GATEWAY_URL = os.environ.get("ORRERY_GATEWAY_URL", "http://gateway:4000/v1")
DEFAULT_MODEL = os.environ.get("ORRERY_MODEL", "claude-sonnet")


def build_model(model_name: str | None = None) -> OpenAIModel:
    """Construct a PydanticAI model routed through the gateway.

    `model_name` defaults to ORRERY_MODEL (a LiteLLM alias such as
    `claude-sonnet`). LiteLLM is unauthenticated in Phase-0 dev; the
    OpenAI client still requires a non-empty api_key string.
    """
    return OpenAIModel(
        model_name or DEFAULT_MODEL,
        provider=OpenAIProvider(base_url=GATEWAY_URL, api_key="orrery-no-auth"),
    )
