# Pull Request

## 📋 Description

Please include a summary of the changes and which issue is fixed. Include relevant motivation and context.

Fixes # (issue)

## 🔄 Type of Change

Please delete options that are not relevant:

- [ ] 🐛 Bug fix (non-breaking change which fixes an issue)
- [ ] ✨ New feature (non-breaking change which adds functionality)
- [ ] 💥 Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] 📝 Documentation update
- [ ] 🎨 Code style update (formatting, renaming)
- [ ] ♻️ Refactoring (no functional changes)
- [ ] ⚡ Performance improvement
- [ ] ✅ Test update
- [ ] 🔧 Build/CI update
- [ ] 🔒 Security fix

## 🧪 Testing

Please describe the tests that you ran to verify your changes:

- [ ] Unit tests
- [ ] Integration tests
- [ ] E2E tests
- [ ] Manual testing

**Test Configuration:**
- Node.js version:
- Actual Budget version:
- Operating System:

**Test Details:**

```bash
# Pre-commit mandatory checks
npm run build                    # No TypeScript errors
npm run test:adapter             # Adapter + retry + concurrency tests
npm run test:unit-js             # Unit tests
npm audit --audit-level=moderate # No critical vulnerabilities
```

## ✅ Checklist

### Code Quality

- [ ] My code follows the style guidelines of this project
- [ ] I have performed a self-review of my own code
- [ ] I have commented my code, particularly in hard-to-understand areas
- [ ] My changes generate no new warnings or errors
- [ ] I have checked for and removed console.log statements

### Documentation

- [ ] I have made corresponding changes to the documentation
- [ ] I have updated the README if needed
- [ ] I have updated `docs/` files relevant to the change (ARCHITECTURE, PROJECT_OVERVIEW, etc.)
- [ ] I have added JSDoc comments for new functions
- [ ] If adding a tool, I ran `npm run docs:sync` to update **Tool Count:** markers

### Testing

- [ ] I have added tests that prove my fix is effective or that my feature works
- [ ] New and existing unit tests pass locally with my changes
- [ ] I have tested the changes manually
- [ ] I have checked that my changes don't break existing functionality

### Commits

- [ ] My commits follow the [Conventional Commits](https://www.conventionalcommits.org/) specification
- [ ] Commit messages clearly describe the changes made
- [ ] I have squashed unnecessary commits

### Dependencies

- [ ] I have not added unnecessary dependencies
- [ ] If I added dependencies, I have justified them in the PR description
- [ ] All dependencies are at their latest stable versions

## 📸 Screenshots (if applicable)

Add screenshots to help explain your changes.

## 🔗 Related Issues

Link related issues here:

- Closes #
- Related to #

## 🚀 Deployment Notes

Are there any special deployment considerations?

- [ ] Requires environment variable changes
- [ ] Requires Docker image rebuild
- [ ] Requires database migration
- [ ] Requires Actual Budget version upgrade
- [ ] Breaking API changes

**Details:**

```
List any deployment steps or considerations
```

## 📊 Performance Impact

Does this change affect performance?

- [ ] No performance impact
- [ ] Improves performance
- [ ] May decrease performance (explain why acceptable)

**Benchmarks (if applicable):**

```
Before: ...
After: ...
```

## 🔒 Security Considerations

- [ ] I have considered security implications of my changes
- [ ] I have not introduced any security vulnerabilities
- [ ] I have not exposed sensitive information (passwords, tokens, etc.)
- [ ] If applicable, I have updated SECURITY.md

## 📝 Additional Notes

Add any other context about the pull request here.

## 🤖 Auto-Merge

If you want this PR to be automatically merged when all checks pass:

- [ ] I want this PR to auto-merge (add `automerge` label)

**Note:** Auto-merge requires:
- ✅ All CI checks passing
- ✅ No merge conflicts
- ✅ Branch up-to-date with main
- ✅ Required approvals (if configured)

---

## For Reviewers

### Review Checklist

- [ ] Code follows project conventions
- [ ] Changes are well-documented
- [ ] Tests are adequate and passing
- [ ] No security concerns
- [ ] Performance is acceptable
- [ ] Breaking changes are documented
- [ ] Ready to merge

### Feedback

(Reviewers: Add your feedback here)
