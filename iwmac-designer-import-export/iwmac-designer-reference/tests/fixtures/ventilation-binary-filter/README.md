# Binary-filter + BACnet ualarm fixtures

Sanitized. Plant prefix `NNNNN`, unit `U01`, no live driver ids, no customer names.

| File | Role |
|---|---|
| `canonical.json` | Passing `PROFILE-BINARY-FILTER-BACNET` panel |
| `sibling-sidebar.json` | 360.002-style sibling with identical sidebar geometry and different bindings |

Live evidence is E29 (`iwmac-panel_4743_360-008-reserve-2_…json` in Downloads). Do not commit it.

Regenerate from `tests/test_ventilation_bacnet_case.py` builders:

```bash
python tests/test_ventilation_bacnet_case.py --write-fixtures
```
