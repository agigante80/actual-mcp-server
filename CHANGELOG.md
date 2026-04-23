# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Changed

- `actual_transactions_uncategorized`: summary fields (`totalCount`, `totalAmount`, `byAccount`) now returned by default; transactions returned only when `includeTransactions: true`; added `offset`, `limit`, `hasMore` pagination fields; **breaking**: `summary.totalAmount` removed, value now at top-level `totalAmount` (issue #121)
