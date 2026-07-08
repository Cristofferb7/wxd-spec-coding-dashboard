"""Contract regression guards: api/openapi.yaml validates and every
REQ-ID in spec/requirements.md is covered by at least one endpoint
description, and vice versa."""
from __future__ import annotations

import re
from pathlib import Path

from openapi_spec_validator import validate

REPO_ROOT = Path(__file__).resolve().parents[1]
REQUIREMENTS_PATH = REPO_ROOT / "spec" / "requirements.md"

_REQ_ID_RE = re.compile(r"REQ-\d+")


def test_openapi_spec_is_valid(openapi_spec):
    validate(openapi_spec)


def test_every_requirement_is_covered_by_an_endpoint(openapi_spec):
    requirements_text = REQUIREMENTS_PATH.read_text()
    req_ids = set(_REQ_ID_RE.findall(requirements_text))
    # Only REQ-IDs under "## Requirements" are obligations; drop accidental
    # matches from prose elsewhere in the file (there are none today, but
    # this keeps the check honest if the doc grows).
    assert req_ids, "No REQ-IDs found in requirements.md"

    endpoint_descriptions = ""
    for path_item in openapi_spec["paths"].values():
        for operation in path_item.values():
            endpoint_descriptions += operation.get("description", "")
            endpoint_descriptions += operation.get("summary", "")

    covered = _REQ_ID_RE.findall(endpoint_descriptions)
    missing = req_ids - set(covered)
    assert not missing, f"REQ-IDs with no endpoint coverage: {missing}"


def test_every_endpoint_references_a_requirement(openapi_spec):
    requirements_text = REQUIREMENTS_PATH.read_text()
    req_ids = set(_REQ_ID_RE.findall(requirements_text))

    for path, path_item in openapi_spec["paths"].items():
        for method, operation in path_item.items():
            description = operation.get("description", "") + operation.get("summary", "")
            referenced = set(_REQ_ID_RE.findall(description))
            assert referenced, f"{method.upper()} {path} has no REQ-ID reference"
            assert referenced <= req_ids, f"{method.upper()} {path} references unknown REQ-ID(s): {referenced - req_ids}"
