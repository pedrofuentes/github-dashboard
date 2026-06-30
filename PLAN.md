# Plan: T-faceted-filter — Resolve sentinel:minor doc/polish batch (#426)

## 5 Sub-items from SENTINEL-422-b7b0ed2:

1. **Line 304 comment**: "debounced via useEffect" is inaccurate — it's a rising-edge detector, not a debounce
   - Action: Correct comment to accurately describe the behavior

2. **Recents list stale after in-panel activation**: refreshes on open; persistence correct
   - Action: Verify behavior — issue notes it's already working correctly (refreshes on open)
   - If satisfied, document as NO ACTION NEEDED

3. **addRecentFilter "never throws" not mechanically enforced**: dead path for Zod inputs
   - Action: Review JSDoc in recent-filters.ts line 62 — comment claims "never throws" but not enforced
   - Likely docs-only fix to clarify the claim

4. **JSDoc hard-codes 5 vs MAX_RECENT_FILTERS**: inconsistency
   - Action: Find and replace hard-coded "5" with {@link MAX_RECENT_FILTERS} in JSDoc

5. **EMPTY_QUERY referenced but not imported + guard broader than stated**:
   - Action: Check if EMPTY_QUERY is referenced in FacetedRepoFilter.tsx
   - Check if any guard logic is documented incorrectly
   - Likely in recent-filters.ts JSDoc

## Execution Strategy:
- Most issues are docs/comments (TDD-exempt per Commit Choreography §Exemptions)
- If any behavior change needed, TDD required (failing test → fix)
- Single commit per logical change: `docs(faceted-filter): <description>`
- Verify against current code first — skip if already satisfied
