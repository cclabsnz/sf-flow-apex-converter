# Changelog

## [2.1.0] - 2026-09-07

### Fixed
- 🐛 **Generated Apex could not compile.** `bulkify` emitted calls to `handleValidationError`,
  three `validate<Subflow>_Bulkified` methods and a `ValidationResult` type, and defined none
  of them. Fixed in the unreleased 2.0.3; now in source and covered by tests.
- 🐛 **Queries hit the wrong object.** Every generated SOQL read `FROM Account` regardless of
  the Flow. The object now comes from the Flow's `<object>`, fields from `<queriedFields>`.
- 🔒 **Nothing ran in user mode.** Generated SOQL now carries `WITH USER_MODE`; DML goes
  through `Database.*(records, AccessLevel.USER_MODE)`.
- 🐛 Method names no longer carry a doubled `_Bulkified` suffix.
- 🐛 Each query result gets a distinct variable name, so two lookups cannot collide.

### Changed
- 📝 **The output no longer overstates itself.** The invented `Status == 'Processing'` block
  is gone, subflow recommendations say "stub, logic NOT migrated" rather than "integrated",
  and both README and CLI describe `bulkify` as a bulk-safe skeleton, not a finished
  conversion.

### Added
- 🧪 `tests/BulkifiedApexGenerator.test.ts` — the generator had no tests, which is why the
  non-compiling output shipped. The undefined-symbol check is mutation-verified against the
  2.0.1 output.
- 📦 A lockfile, so builds are reproducible.

### Note on 2.0.2 and 2.0.3
Both were published to npm on 2025-08-21 from a tree that was never committed; this repo
sat at 2.0.1 and tags stopped at v2.0.1. Their source has been reconstructed from the
published `dist` and verified by output parity. 2.0.3 also hardcoded `--version` as
`1.0.0`, losing the `package.json` read; that regression is not carried forward.

## [2.0.0] - 2024-08-07

### 🎉 Major Release - Complete Rewrite

#### Added
- ✨ New `SimplifiedFlowAnalyzer` - Accurate loop detection and element tracking
- ✨ New `BulkifiedApexGenerator` - Generates optimized Apex code
- 📊 `analyze` command - Quick flow analysis for governor limit issues
- 🔧 `bulkify` command - Complete flow-to-apex conversion
- 📝 Comprehensive analysis reports with actionable recommendations
- 🧪 Automatic test class generation with proper coverage

#### Changed
- 🔄 Complete rewrite focusing on simplicity and accuracy
- 📦 Reduced codebase by 90% (from 100+ files to 6 core files)
- 🎯 Focused solely on bulkification problem
- 📚 Complete documentation rewrite with examples

#### Fixed
- ✅ XML parsing now handles all Salesforce Flow structures
- ✅ Loop detection accurately identifies elements inside loops
- ✅ Subflows in loops are properly detected and reported
- ✅ No more TypeScript type errors

#### Removed
- ❌ Complex type system that caused confusion
- ❌ Unused analyzer modules
- ❌ Overcomplicated inheritance hierarchies
- ❌ Deployment features (focus on code generation)

### Migration Guide

Old commands are replaced:
```bash
# Old (v1.x)
sf-flow-apex-converter MyFlow --from-org

# New (v2.0)
sf-flow-apex-converter analyze MyFlow.xml
sf-flow-apex-converter bulkify MyFlow.xml
```

## [1.2.0] - Previous version
- Initial release with complex architecture

---

For more details, see the [README](README.md)