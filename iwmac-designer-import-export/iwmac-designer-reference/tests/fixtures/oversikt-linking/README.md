# Oversikt link-verification fixtures

Synthetic regression evidence for the 2026-08-12 linking failure.

- `verified-panel.json`: two fictional controllers, four Oversikt roles each.
- `parameters.json`: one exact fictional source row per object.
- `incident-cases.json`: nine mutations reproducing the required failure
  classes. `partial-six-of-eight` is the small analogue of 120 exact matches
  among 184 production objects.

Generate inspectable negative panel files with:

```bash
python build-oversikt-linking-negatives.py --out survey-tmp/oversikt-linking
```

Privacy: all driver ids use the `NNNNN` mask; controller and unit names are
fixture-only. No live plant id, customer name, personal name, workbook row or
unsanitized identifier was copied. Counts and mutation categories come from the
incident narrative; no production geometry or parameter value is retained.
