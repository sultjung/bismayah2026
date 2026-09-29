#!/usr/bin/env python3
"""Verify the repository OpenAI secret before collectors touch published data."""

from __future__ import annotations

import json
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def main() -> int:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        print("OPENAI_API_KEY is missing; add it to the repository Actions secrets.", file=sys.stderr)
        return 1

    request = Request(
        "https://api.openai.com/v1/models",
        headers={"Authorization": f"Bearer {api_key}"},
        method="GET",
    )
    try:
        with urlopen(request, timeout=20) as response:
            if response.status == 200:
                print("OpenAI API key check passed (no generation request or token usage).")
                return 0
            print(f"OpenAI API key check failed: HTTP {response.status}.", file=sys.stderr)
            return 1
    except HTTPError as error:
        code = ""
        try:
            body = json.loads(error.read().decode("utf-8", errors="replace"))
            code = str((body.get("error") or {}).get("code") or "")
        except (ValueError, AttributeError):
            pass
        if error.code == 401 or code == "invalid_api_key":
            print("OpenAI rejected OPENAI_API_KEY (401 invalid_api_key). Replace the repository Actions secret before running collectors.", file=sys.stderr)
        else:
            detail = f" ({code})" if code else ""
            print(f"OpenAI API key check failed: HTTP {error.code}{detail}.", file=sys.stderr)
        return 1
    except (URLError, TimeoutError, OSError) as error:
        print(f"OpenAI API key check could not reach the API: {type(error).__name__}.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
