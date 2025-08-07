# Changelog

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