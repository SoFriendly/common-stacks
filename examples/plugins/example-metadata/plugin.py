#!/usr/bin/env python3
"""
Example CommonStacks metadata enricher plugin.

This is a complete, runnable plugin. It implements the v1 CommonStacks plugin
subprocess protocol: the host invokes us once per call with a single command
argument and an optional JSON payload on stdin, then reads a JSON response
from stdout.

Behavior: echoes the query back with a fake description so you can see the
plugin loaded and called.
"""

import json
import sys


def cmd_enrich() -> int:
    """Enrich a book.

    stdin:  EnrichQuery JSON
    stdout: EnrichedMetadata JSON (exit 0) or empty (exit 1) or error (exit 2)
    """
    query = json.load(sys.stdin)
    title = query.get("title")
    if not title:
        # No title to work with -> no result for this query.
        return 1

    result = {
        "source": "example-metadata",
        "title": title,
        "authors": query.get("authors", []),
        "description": f'A book titled "{title}".',
        "subjects": ["Example"],
        "identifiers": (
            [f'urn:isbn:{query["isbn"]}'] if query.get("isbn") else []
        ),
    }
    json.dump(result, sys.stdout)
    return 0


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: plugin.py <command>", file=sys.stderr)
        return 2

    command = sys.argv[1]
    try:
        if command == "enrich":
            return cmd_enrich()
        # Schema/applies_to commands aren't applicable to metadata enrichers.
        print(f"unknown command: {command}", file=sys.stderr)
        return 2
    except Exception as e:
        print(f"plugin error: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
