from riskmodels.capabilities import DISCOVER_SPEC, discover_markdown


def test_discover_spec_keys():
    assert set(DISCOVER_SPEC.keys()) >= {
        "sdk_version",
        "methods",
        "limits",
        "snippets",
        "auth",
        "costs",
        "tool_definition_hints",
    }


def test_each_method_has_description_and_parameters():
    for m in DISCOVER_SPEC["methods"]:
        assert "name" in m
        assert m.get("description")
        assert isinstance(m.get("parameters"), list)
        assert m["parameters"], f"{m['name']} should list parameters for tool JSON"
        for p in m["parameters"]:
            assert "name" in p and "type" in p and "description" in p


def test_discover_markdown_contains_aliases():
    md = discover_markdown()
    assert "get_risk" in md
    assert "get_metrics" in md
