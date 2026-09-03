---
name: api-design-principles
description: API design principles for the actual-mcp-server MCP tool surface (and REST/GraphQL in general). Use when adding or revising an MCP tool, reviewing tool schemas for consistency across the 76-tool set, or establishing tool-design standards. The general REST/GraphQL material is the reference; the project section maps it to MCP tools.
---

<!-- api-design-principles-version: 1 -->

# API Design Principles

Master REST and GraphQL API design principles to build intuitive, scalable, and maintainable APIs that delight developers and stand the test of time.

## When to Use This Skill

- Designing new REST or GraphQL APIs
- Refactoring existing APIs for better usability
- Establishing API design standards for your team
- Reviewing API specifications before implementation
- Migrating between API paradigms (REST to GraphQL, etc.)
- Creating developer-friendly API documentation
- Optimizing APIs for specific use cases (mobile, third-party integrations)

## Applying this to actual-mcp-server (the project API is MCP tools)

This project exposes no REST or GraphQL surface: its "API" is the set of 71 MCP tools
advertised over the HTTP and stdio transports. Read the generic REST/GraphQL sections below
as the underlying principles, and apply them through these project rules (from CLAUDE.md):

- **Resource-oriented naming maps to `actual_{domain}_{action}`.** The domain is the noun
  (`accounts`, `transactions`, `budgets`, `payees`, `rules`, `schedules`), the action is the verb
  (`create`, `update`, `delete`, `list`, `get`, `search`). Keep a new tool consistent with the
  existing names in `src/actualToolsManager.ts` (`IMPLEMENTED_TOOLS`); a lone inconsistent verb is
  the tell that the design drifted.
- **The schema IS the contract.** Every tool's input is a Zod object (prefer `createTool()` from
  `src/lib/toolFactory.ts`; reuse fields from `CommonSchemas` in `src/lib/schemas/common.ts`). The
  published JSON Schema is what clients (and models) consume, so it must be self-describing and
  strict-client-safe: keep it ECMA-262/OpenAI-compatible (no `\p{...}`/`\u{...}` patterns, guarded
  by `tests/unit/schema_json_openai_compat.test.js`), and give every field a `.describe()`.
- **Types are fixed by convention, not per-tool invention.** Amounts are always integer cents
  (`5000` = $50.00, never decimal dollars). Dates are `YYYY-MM-DD` strings, never `Date.now()`.
  IDs use `CommonSchemas.<entity>Id`, and `tests/unit/tool_id_schema_drift.test.js` fails the
  build if an id-shaped field does not (#380). Note this line USED to be aspirational: when
  the guard was written, 33 of 41 id fields were on one of three looser forms (a bare
  `z.string()`, a `.min(1).max(64)` bound, or an inline `UUID_PATTERN` meaning the identical
  thing), so `accounts_update.id` was published as a UUID while `categories_update.id` was
  published as any string. A convention four fifths of the surface ignores is not a
  convention, which is why it is now enforced rather than stated.

  The guard's exception list is the honest part: an MCP `sessionId` and a bank's
  `imported_id` are not Actual UUIDs and must not be typed as one, and the OPTIONAL FILTER
  ids (`transactions_filter`, the `search_by_*` family) are deliberately still loose,
  because tightening them turns "a name returns nothing" into "a name is a schema error",
  which is a behaviour change needing its own decision.
- **Errors are messages, not status codes.** There is no HTTP status layer at the tool boundary:
  use the shared helpers `notFoundMsg()` / `constraintErrorMsg()` from `src/lib/errors.ts` so a
  "not found" or constraint failure reads consistently across all 76 tools. Domain/validation
  errors must not drop the pooled connection (see `_shouldDropPoolOnError` in `actual-adapter.ts`).
- **The refusal SHAPE is fixed by the taxonomy below, and decided by TYPE, never by prose.**
  The bullet above governs the wording; this one governs which response shape carries it.

- **Annotations describe a tool; they never authorise it (#379).** Every tool publishes MCP
  `readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint` from
  `src/lib/tool-annotations.ts`. The spec is explicit that these are HINTS and that clients
  must treat them as untrusted, so no code in `src/` may branch on one. They are for the
  client's benefit, not the server's. Note the defaults are already conservative
  (`destructiveHint` and `openWorldHint` both default to TRUE), so the useful work is
  declaring what is SAFE and correcting `openWorldHint`, which is wrong for every tool here
  except `actual_bank_sync`. An annotation that lies is worse than none, which is why
  `tests/unit/tool_annotations.test.js` checks each claim against the adapter call graph.

### The refusal taxonomy (#377)

"You asked for something that cannot happen" had five different shapes across this surface, and
the two tools using the structured shape picked it by substring-matching the adapter's English.
A copy-edit to a message in `actual-adapter.ts` could therefore flip a published contract with
nothing red to show for it. Three rules, in the order you should apply them:

1. **The requested end state ALREADY HOLDS** (closing an already-closed account, reopening an
   already-open one): return **SUCCESS**, with a field naming the non-change
   (`alreadyClosed: true`, `alreadyOpen: true`, `removed: true`). This is #347's idempotence
   argument: the caller's intent is satisfied, so reporting failure would be a lie. Do NOT
   invent a refusal for it.

   **Deleting an id that does not exist is NOT this case, on this surface.**
   `rules_delete`, `category_groups_delete`, `schedules_delete`, `payees_delete`,
   `categories_delete` and `tags_delete` all THROW a `NotFoundRefusal`, and #376
   re-committed to that when it moved those guards into the adapter. The single exception is `actual_accounts_delete`, which
   verifies AFTER the write and therefore reports success for an absent id; its own file and
   `docs/audit/write-effect-audit.md` explain why (a close-then-reopen leaves an id that no
   listing returns, so a pre-check would refuse a request whose intent is already satisfied).
   Follow the majority: a delete of an unknown id throws.
2. **The request NAMES SOMETHING THAT DOES NOT EXIST, or upstream will not do it**: **THROW**.
   It is a caller error, and MCP's error channel is where a model can see it and self-correct.
   Throw a typed refusal from `src/lib/errors.ts`: `NotFoundRefusal(entity, id, listTool)` or
   `OutOfRangeRefusal(message, value)`, both of which extend `PreflightRefusal` and mean "the
   operation was not attempted and nothing was written".
3. **`{ success: false, error }` earns its place ONLY where a tool genuinely has a
   partial-success or multi-outcome contract.** Two tools return it without having one
   (`budgets_setAmount` from #89, `transactions_create` from #359); both are historical, and
   converting them is a published-contract change that is deliberately NOT bundled with the
   typed error. If you are writing a NEW tool, rule 2 applies: throw.

**When a tool must map a refusal to a structured shape, ask the type, not the text:**

```ts
import { isPreflightRefusal } from '../lib/errors.js';
// ...
} catch (error) {
  if (isPreflightRefusal(error)) return { success: false as const, error: msg };
  throw new Error(`Failed to ...: ${msg}`);   // a genuine failure must NOT be swallowed
}
```

Use `isPreflightRefusal()` rather than a bare `instanceof`: it also checks a `Symbol.for` brand,
so a duplicate module instance cannot silently downgrade a refusal into a generic failure.

**The other half of the rule is that a NON-refusal must never be swallowed into the refusal
shape.** A transport or upstream error reported to a model as a tidy "category not found" is an
error it will try to fix by changing the category id, forever. Prose matching had exactly this
bug in the other direction: any message containing "not found" and "category" was converted,
including an upstream error that merely mentioned both words.

**Known deviations**, so the list is honest rather than aspirational: `notes_update` returns
`{ error }` with no `success` field at all, and `adapter.createTransfer` returns
`{ success: false, error }` from the ADAPTER rather than throwing. Both predate this taxonomy
and are tracked on #377 for a separate, deliberate contract change.
- **Versioning is the product version, not a URL prefix.** The tool set evolves under the `VERSION`
  file and `vX.Y.Z` tags; there is no `/v1/` path. A breaking tool-schema change is a considered
  release event, not a silent edit (adding a tool is a minor bump; changing a field contract needs
  the doc-sync + dual-transport gate).
- **Consistency across the set beats local cleverness.** Before designing a new tool, read two or
  three sibling tools in `src/tools/` and match their pagination, filtering, and return shape.
  `docs/NEW_TOOL_CHECKLIST.md` is the canonical 9-step guide.

## Core Concepts

### 1. RESTful Design Principles

**Resource-Oriented Architecture**

- Resources are nouns (users, orders, products), not verbs
- Use HTTP methods for actions (GET, POST, PUT, PATCH, DELETE)
- URLs represent resource hierarchies
- Consistent naming conventions

**HTTP Methods Semantics:**

- `GET`: Retrieve resources (idempotent, safe)
- `POST`: Create new resources
- `PUT`: Replace entire resource (idempotent)
- `PATCH`: Partial resource updates
- `DELETE`: Remove resources (idempotent)

### 2. GraphQL Design Principles

**Schema-First Development**

- Types define your domain model
- Queries for reading data
- Mutations for modifying data
- Subscriptions for real-time updates

**Query Structure:**

- Clients request exactly what they need
- Single endpoint, multiple operations
- Strongly typed schema
- Introspection built-in

### 3. API Versioning Strategies

**URL Versioning:**

```
/api/v1/users
/api/v2/users
```

**Header Versioning:**

```
Accept: application/vnd.api+json; version=1
```

**Query Parameter Versioning:**

```
/api/users?version=1
```

## REST API Design Patterns

### Pattern 1: Resource Collection Design

```python
# Good: Resource-oriented endpoints
GET    /api/users              # List users (with pagination)
POST   /api/users              # Create user
GET    /api/users/{id}         # Get specific user
PUT    /api/users/{id}         # Replace user
PATCH  /api/users/{id}         # Update user fields
DELETE /api/users/{id}         # Delete user

# Nested resources
GET    /api/users/{id}/orders  # Get user's orders
POST   /api/users/{id}/orders  # Create order for user

# Bad: Action-oriented endpoints (avoid)
POST   /api/createUser
POST   /api/getUserById
POST   /api/deleteUser
```

### Pattern 2: Pagination and Filtering

```python
from typing import List, Optional
from pydantic import BaseModel, Field

class PaginationParams(BaseModel):
    page: int = Field(1, ge=1, description="Page number")
    page_size: int = Field(20, ge=1, le=100, description="Items per page")

class FilterParams(BaseModel):
    status: Optional[str] = None
    created_after: Optional[str] = None
    search: Optional[str] = None

class PaginatedResponse(BaseModel):
    items: List[dict]
    total: int
    page: int
    page_size: int
    pages: int

    @property
    def has_next(self) -> bool:
        return self.page < self.pages

    @property
    def has_prev(self) -> bool:
        return self.page > 1

# FastAPI endpoint example
from fastapi import FastAPI, Query, Depends

app = FastAPI()

@app.get("/api/users", response_model=PaginatedResponse)
async def list_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None)
):
    # Apply filters
    query = build_query(status=status, search=search)

    # Count total
    total = await count_users(query)

    # Fetch page
    offset = (page - 1) * page_size
    users = await fetch_users(query, limit=page_size, offset=offset)

    return PaginatedResponse(
        items=users,
        total=total,
        page=page,
        page_size=page_size,
        pages=(total + page_size - 1) // page_size
    )
```

### Pattern 3: Error Handling and Status Codes

```python
from fastapi import HTTPException, status
from pydantic import BaseModel

class ErrorResponse(BaseModel):
    error: str
    message: str
    details: Optional[dict] = None
    timestamp: str
    path: str

class ValidationErrorDetail(BaseModel):
    field: str
    message: str
    value: Any

# Consistent error responses
STATUS_CODES = {
    "success": 200,
    "created": 201,
    "no_content": 204,
    "bad_request": 400,
    "unauthorized": 401,
    "forbidden": 403,
    "not_found": 404,
    "conflict": 409,
    "unprocessable": 422,
    "internal_error": 500
}

def raise_not_found(resource: str, id: str):
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={
            "error": "NotFound",
            "message": f"{resource} not found",
            "details": {"id": id}
        }
    )

def raise_validation_error(errors: List[ValidationErrorDetail]):
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail={
            "error": "ValidationError",
            "message": "Request validation failed",
            "details": {"errors": [e.dict() for e in errors]}
        }
    )

# Example usage
@app.get("/api/users/{user_id}")
async def get_user(user_id: str):
    user = await fetch_user(user_id)
    if not user:
        raise_not_found("User", user_id)
    return user
```

### Pattern 4: HATEOAS (Hypermedia as the Engine of Application State)

```python
class UserResponse(BaseModel):
    id: str
    name: str
    email: str
    _links: dict

    @classmethod
    def from_user(cls, user: User, base_url: str):
        return cls(
            id=user.id,
            name=user.name,
            email=user.email,
            _links={
                "self": {"href": f"{base_url}/api/users/{user.id}"},
                "orders": {"href": f"{base_url}/api/users/{user.id}/orders"},
                "update": {
                    "href": f"{base_url}/api/users/{user.id}",
                    "method": "PATCH"
                },
                "delete": {
                    "href": f"{base_url}/api/users/{user.id}",
                    "method": "DELETE"
                }
            }
        )
```

## GraphQL Design Patterns

### Pattern 1: Schema Design

```graphql
# schema.graphql

# Clear type definitions
type User {
  id: ID!
  email: String!
  name: String!
  createdAt: DateTime!

  # Relationships
  orders(first: Int = 20, after: String, status: OrderStatus): OrderConnection!

  profile: UserProfile
}

type Order {
  id: ID!
  status: OrderStatus!
  total: Money!
  items: [OrderItem!]!
  createdAt: DateTime!

  # Back-reference
  user: User!
}

# Pagination pattern (Relay-style)
type OrderConnection {
  edges: [OrderEdge!]!
  pageInfo: PageInfo!
  totalCount: Int!
}

type OrderEdge {
  node: Order!
  cursor: String!
}

type PageInfo {
  hasNextPage: Boolean!
  hasPreviousPage: Boolean!
  startCursor: String
  endCursor: String
}

# Enums for type safety
enum OrderStatus {
  PENDING
  CONFIRMED
  SHIPPED
  DELIVERED
  CANCELLED
}

# Custom scalars
scalar DateTime
scalar Money

# Query root
type Query {
  user(id: ID!): User
  users(first: Int = 20, after: String, search: String): UserConnection!

  order(id: ID!): Order
}

# Mutation root
type Mutation {
  createUser(input: CreateUserInput!): CreateUserPayload!
  updateUser(input: UpdateUserInput!): UpdateUserPayload!
  deleteUser(id: ID!): DeleteUserPayload!

  createOrder(input: CreateOrderInput!): CreateOrderPayload!
}

# Input types for mutations
input CreateUserInput {
  email: String!
  name: String!
  password: String!
}

# Payload types for mutations
type CreateUserPayload {
  user: User
  errors: [Error!]
}

type Error {
  field: String
  message: String!
}
```

### Pattern 2: Resolver Design

```python
from typing import Optional, List
from ariadne import QueryType, MutationType, ObjectType
from dataclasses import dataclass

query = QueryType()
mutation = MutationType()
user_type = ObjectType("User")

@query.field("user")
async def resolve_user(obj, info, id: str) -> Optional[dict]:
    """Resolve single user by ID."""
    return await fetch_user_by_id(id)

@query.field("users")
async def resolve_users(
    obj,
    info,
    first: int = 20,
    after: Optional[str] = None,
    search: Optional[str] = None
) -> dict:
    """Resolve paginated user list."""
    # Decode cursor
    offset = decode_cursor(after) if after else 0

    # Fetch users
    users = await fetch_users(
        limit=first + 1,  # Fetch one extra to check hasNextPage
        offset=offset,
        search=search
    )

    # Pagination
    has_next = len(users) > first
    if has_next:
        users = users[:first]

    edges = [
        {
            "node": user,
            "cursor": encode_cursor(offset + i)
        }
        for i, user in enumerate(users)
    ]

    return {
        "edges": edges,
        "pageInfo": {
            "hasNextPage": has_next,
            "hasPreviousPage": offset > 0,
            "startCursor": edges[0]["cursor"] if edges else None,
            "endCursor": edges[-1]["cursor"] if edges else None
        },
        "totalCount": await count_users(search=search)
    }

@user_type.field("orders")
async def resolve_user_orders(user: dict, info, first: int = 20) -> dict:
    """Resolve user's orders (N+1 prevention with DataLoader)."""
    # Use DataLoader to batch requests
    loader = info.context["loaders"]["orders_by_user"]
    orders = await loader.load(user["id"])

    return paginate_orders(orders, first)

@mutation.field("createUser")
async def resolve_create_user(obj, info, input: dict) -> dict:
    """Create new user."""
    try:
        # Validate input
        validate_user_input(input)

        # Create user
        user = await create_user(
            email=input["email"],
            name=input["name"],
            password=hash_password(input["password"])
        )

        return {
            "user": user,
            "errors": []
        }
    except ValidationError as e:
        return {
            "user": None,
            "errors": [{"field": e.field, "message": e.message}]
        }
```

### Pattern 3: DataLoader (N+1 Problem Prevention)

```python
from aiodataloader import DataLoader
from typing import List, Optional

class UserLoader(DataLoader):
    """Batch load users by ID."""

    async def batch_load_fn(self, user_ids: List[str]) -> List[Optional[dict]]:
        """Load multiple users in single query."""
        users = await fetch_users_by_ids(user_ids)

        # Map results back to input order
        user_map = {user["id"]: user for user in users}
        return [user_map.get(user_id) for user_id in user_ids]

class OrdersByUserLoader(DataLoader):
    """Batch load orders by user ID."""

    async def batch_load_fn(self, user_ids: List[str]) -> List[List[dict]]:
        """Load orders for multiple users in single query."""
        orders = await fetch_orders_by_user_ids(user_ids)

        # Group orders by user_id
        orders_by_user = {}
        for order in orders:
            user_id = order["user_id"]
            if user_id not in orders_by_user:
                orders_by_user[user_id] = []
            orders_by_user[user_id].append(order)

        # Return in input order
        return [orders_by_user.get(user_id, []) for user_id in user_ids]

# Context setup
def create_context():
    return {
        "loaders": {
            "user": UserLoader(),
            "orders_by_user": OrdersByUserLoader()
        }
    }
```

## Best Practices

### REST APIs

1. **Consistent Naming**: Use plural nouns for collections (`/users`, not `/user`)
2. **Stateless**: Each request contains all necessary information
3. **Use HTTP Status Codes Correctly**: 2xx success, 4xx client errors, 5xx server errors
4. **Version Your API**: Plan for breaking changes from day one
5. **Pagination**: Always paginate large collections
6. **Rate Limiting**: Protect your API with rate limits
7. **Documentation**: Use OpenAPI/Swagger for interactive docs

### GraphQL APIs

1. **Schema First**: Design schema before writing resolvers
2. **Avoid N+1**: Use DataLoaders for efficient data fetching
3. **Input Validation**: Validate at schema and resolver levels
4. **Error Handling**: Return structured errors in mutation payloads
5. **Pagination**: Use cursor-based pagination (Relay spec)
6. **Deprecation**: Use `@deprecated` directive for gradual migration
7. **Monitoring**: Track query complexity and execution time

## Common Pitfalls

- **Over-fetching/Under-fetching (REST)**: Fixed in GraphQL but requires DataLoaders
- **Breaking Changes**: Version APIs or use deprecation strategies
- **Inconsistent Error Formats**: Standardize error responses
- **Missing Rate Limits**: APIs without limits are vulnerable to abuse
- **Poor Documentation**: Undocumented APIs frustrate developers
- **Ignoring HTTP Semantics**: POST for idempotent operations breaks expectations
- **Tight Coupling**: API structure shouldn't mirror database schema
