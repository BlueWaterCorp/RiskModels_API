"""Cache-boundary tests; numeric normalization is tested in BWMACRO."""
import json
import sys
import types
from unittest.mock import Mock

import pytest
from fastapi import HTTPException

from render_svc import artifacts as a


@pytest.fixture
def mod(monkeypatch):
    renderer = types.SimpleNamespace(
        BASELINE_REVISION='first-close-1', APPLICABLE_SUBJECT_KINDS=('fund', 'filer_13f'),
        RENDER_PARAMS=('window',), render_data=Mock(return_value={'rendered': True}),
    )
    renderer.render_figure = Mock(return_value=types.SimpleNamespace(
        to_image=lambda **kwargs: b'NEW-VALIDATED-FIGURE'))
    monkeypatch.setattr(a, '_import_artifact_module', lambda *args: renderer)
    monkeypatch.setattr(a, '_load_subject_data', lambda *args: (object(), '2026-05-31'))
    monkeypatch.setattr(a, '_adapter_for', lambda *args: lambda data: data)
    package = types.ModuleType('bwmacro.snapshots.artifacts')
    package.CumulativeReturnSeries = types.SimpleNamespace
    monkeypatch.setitem(sys.modules, 'bwmacro.snapshots.artifacts', package)
    return renderer


def req(subject='BW-FUND-S000009228', **kwargs):
    return a.ArtifactRenderRequest(slug='cumulative_return_strip', version='v1',
        subject_id=subject, as_of='2026-05-31', format=kwargs.pop('format', 'json'), **kwargs)


def legacy_path(subject):
    return f'snapshots/artifacts/cumulative_return_strip@v1/{subject}/2026-05-31.json'


def numeric():
    return json.dumps({'slug': 'cumulative_return_strip', 'version': 'v1',
        'subject_label': 'Filer', 'window_requested': 'max',
        'axis': {'y_unit': 'percent_cumulative_return'},
        'series': [{'layer': 'gross', 'rows': [
            {'date': '2025-01-31', 'value_pct': 5.0},
            {'date': '2025-02-28', 'value_pct': 8.0},
        ]}]}).encode()


def test_old_fund_bytes_are_preserved_and_not_served(store, mod):
    old = legacy_path('BW-FUND-S000009228')
    store.write(old, b'OLD-DUPLICATE-DATE-CHART', content_type='application/json')
    raw, _, path, _, _, receipt = a.render_artifact(req(), store=store, prefix='snapshots')
    assert json.loads(raw) == {'rendered': True}
    assert path.endswith('.baseline-first-close-1.json')
    assert store.read(old) == b'OLD-DUPLICATE-DATE-CHART'
    assert a._receipt_id(old) != receipt
    a.render_artifact(req(), store=store, prefix='snapshots')
    assert mod.render_data.call_count == 1  # corrected cache now reused


@pytest.mark.parametrize('fmt', ['json', 'png'])
def test_filer_numeric_source_is_rerendered_and_preserved(store, mod, fmt):
    subject = 'BW-FILER-0001067983'
    old = legacy_path(subject)
    source = numeric()
    store.write(old, source, content_type='application/json')
    raw, _, path, *_ = a.render_artifact(req(subject, format=fmt, params={'window': '3m'}),
        store=store, prefix='snapshots')
    renderer = mod.render_data if fmt == 'json' else mod.render_figure
    normalized = renderer.call_args.args[0]
    assert normalized.gross == [('2025-01-31', 0.05), ('2025-02-28', 0.08)]
    assert renderer.call_args.kwargs == {'window': '3m'}
    assert '.window-3m.baseline-first-close-1.' in path
    assert store.read(old) == source
    assert raw != source


def test_legacy_image_without_numbers_is_not_certified(store, mod):
    subject = 'BW-FILER-0001067983'
    old = legacy_path(subject).removesuffix('.json') + '.png'
    store.write(old, b'UNVERIFIED-LEGACY-IMAGE', content_type='image/png')
    with pytest.raises(HTTPException) as exc:
        a.render_artifact(req(subject, format='png'), store=store, prefix='snapshots')
    assert exc.value.status_code == 501
    assert 'full numeric' in exc.value.detail
    assert not mod.render_figure.called


def test_invalid_numeric_baseline_stops_before_cache_write(store, mod):
    subject = 'BW-FILER-0001067983'
    old = legacy_path(subject)
    store.write(old, numeric(), content_type='application/json')
    mod.render_data.side_effect = ValueError('cumulative return dates must be ascending and unique')
    with pytest.raises(HTTPException) as exc:
        a.render_artifact(req(subject), store=store, prefix='snapshots')
    assert exc.value.status_code == 422
    assert list(store.objects) == [old]


def test_cache_revision_requires_matching_renderer(store, mod):
    mod.BASELINE_REVISION = 'older'
    with pytest.raises(HTTPException) as exc:
        a.render_artifact(req(), store=store, prefix='snapshots')
    assert exc.value.status_code == 503


def test_revision_is_hidden_from_customer_window_variants(store):
    from render_svc.artifacts import available_vintages
    subject = 'BW-FUND-S000009228'
    for fragment in ['', '.window-3m']:
        path = a._artifact_gcs_path('snapshots', 'cumulative_return_strip', 'v1', subject,
            '2026-05-31', 'json', fragment)
        store.write(path, b'{}', content_type='application/json')
    [vintage] = available_vintages(store, 'snapshots', 'cumulative_return_strip', 'v1', subject)
    assert vintage.formats == ('json',)
    assert vintage.params_variants == ('window-3m',)


@pytest.mark.parametrize('mutate', [
    lambda p: p.update(window_requested='3m'),
    lambda p: p.update(axis={'y_unit': 'fraction'}),
    lambda p: p['series'][0]['rows'][0].update(value_pct=True),
    lambda p: p['series'].append(p['series'][0]),
])
def test_legacy_numeric_contract_must_be_unambiguous(mod, mutate):
    p = json.loads(numeric())
    mutate(p)
    with pytest.raises(HTTPException) as exc:
        a._legacy_filer_cumulative_data(json.dumps(p).encode())
    assert exc.value.status_code == 422
