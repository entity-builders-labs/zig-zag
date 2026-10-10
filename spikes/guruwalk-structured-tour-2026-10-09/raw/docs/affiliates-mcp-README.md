# GuruWalk MCP — Affiliate Integration Guide

GuruWalk exposes a subset of its tour catalog through the [Model Context Protocol](https://modelcontextprotocol.io) (MCP), allowing affiliates to embed tour discovery, browsing, and availability checking directly into their own AI agents and assistants.

All URLs returned by the tools include your affiliate `?ref=<username>` parameter automatically, so bookings driven by your agent are attributed to your account.

---

## Endpoint

```
POST https://back.guruwalk.com/mcp/affiliates
```

The server implements MCP over **Streamable HTTP**, stateless mode. Every request is independent — no session state is maintained between calls.

---

## Authentication

Include your API key on every request using one of these headers:

```
Authorization: Bearer <api_key>
```

or

```
Api-Key: <api_key>
```

Requests without a valid key receive `401 Unauthorized`.

---

## Protocol

This server follows the [MCP specification](https://modelcontextprotocol.io). Use any MCP-compatible client library:

- Python: [`mcp`](https://pypi.org/project/mcp/)
- TypeScript/JavaScript: [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk)

The transport is **Streamable HTTP** (not SSE, not stdio). The server is stateless — pass `stateless: true` (or equivalent) in your client transport configuration.

---

## Tools

### `discover_destination`

Find free walking tours available in a city. Returns the destination info, tour categories to browse, and a paginated list of featured tours. Optionally filter by date range and language.

**Parameters**

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `destination` | string | yes | — | City or destination name, e.g. `"Rome"`, `"Barcelona"` |
| `language` | string | no | `"en"` | Language for tour names and descriptions. One of: `en`, `es`, `de`, `it` |
| `start_date` | string | no | — | Only show tours available from this date (`YYYY-MM-DD`) |
| `end_date` | string | no | — | Only show tours available until this date (`YYYY-MM-DD`) |
| `page` | integer | no | `1` | Page number for the featured tours list |

**Response**

```json
{
  "place": {
    "id": 12,
    "name": "Rome",
    "slug": "rome",
    "country": "Italy",
    "has_free_tours": true
  },
  "pagination": {
    "page": 1,
    "per_page": 12,
    "total_count": 34
  },
  "categories": [
    {
      "id": 5,
      "name": "Ancient Rome",
      "url": "https://www.guruwalk.com/en/walks/rome/ancient-rome?ref=myaffiliate"
    }
  ],
  "featured_products": [
    {
      "id": 101,
      "name": "Classic Rome Free Tour",
      "slug": "classic-rome-free-tour",
      "rating_out_of_5": 4.9,
      "reviews_count": 312,
      "image_url": "https://cdn.guruwalk.com/tours/101.jpg",
      "url": "https://www.guruwalk.com/walks/classic-rome-free-tour?ref=myaffiliate"
    }
  ]
}
```

---

### `browse_category`

List free walking tours within a category. Use a `category_id` from `discover_destination` results. Returns paginated tours with ratings, images, and booking URLs.

**Parameters**

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `category_id` | integer | yes | — | Category ID returned by `discover_destination` |
| `language` | string | no | `"en"` | Language for tour names and category labels. One of: `en`, `es`, `de`, `it` |
| `page` | integer | no | `1` | Page number for paginated results |

**Response**

```json
{
  "category": {
    "id": 5,
    "name": "Ancient Rome",
    "url": "https://www.guruwalk.com/en/walks/rome/ancient-rome?ref=myaffiliate"
  },
  "place": {
    "name": "Rome",
    "slug": "rome"
  },
  "pagination": {
    "page": 1,
    "per_page": 12,
    "total_count": 8
  },
  "products": [
    {
      "id": 101,
      "name": "Classic Rome Free Tour",
      "slug": "classic-rome-free-tour",
      "rating_out_of_5": 4.9,
      "reviews_count": 312,
      "image_url": "https://cdn.guruwalk.com/tours/101.jpg",
      "url": "https://www.guruwalk.com/walks/classic-rome-free-tour?ref=myaffiliate"
    }
  ]
}
```

---

### `check_availability`

Check when a free walking tour has upcoming events. Use a `tour_id` from `discover_destination` or `browse_category` results. Returns available time slots with dates, times, languages, and booking URLs.

**Parameters**

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `tour_id` | integer | yes | — | Tour ID from `discover_destination` or `browse_category` results |
| `from_date` | string | yes | — | Start of date range (`YYYY-MM-DD`) |
| `to_date` | string | yes | — | End of date range (`YYYY-MM-DD`) |
| `language` | string | no | `"en"` | Language for tour names and descriptions. One of: `en`, `es`, `de`, `it` |

**Response**

The `dates` object contains one key per day in the requested range. Days with no events have an empty array.

```json
{
  "tour_id": 101,
  "from_date": "2025-06-10",
  "to_date": "2025-06-12",
  "dates": {
    "2025-06-10": [
      {
        "event_id": 9901,
        "start_time": "10:00",
        "language": "en",
        "last_seats": false,
        "booking_url": "https://www.guruwalk.com/walks/classic-rome-free-tour?beginsAt=2025-06-10&endsAt=2025-06-10&ref=myaffiliate"
      }
    ],
    "2025-06-11": [],
    "2025-06-12": [
      {
        "event_id": 9902,
        "start_time": "11:00",
        "language": "en",
        "last_seats": true,
        "booking_url": "https://www.guruwalk.com/walks/classic-rome-free-tour?beginsAt=2025-06-12&endsAt=2025-06-12&ref=myaffiliate"
      }
    ]
  }
}
```

---

## Typical Flow

A natural conversation flow for a travel assistant looks like this:

```
1. discover_destination(destination: "Barcelona", language: "en")
   → get place info, category list, and featured tours

2. browse_category(category_id: <id from step 1>, language: "en")
   → drill into a specific category to see all tours

3. check_availability(tour_id: <id from step 1 or 2>, from_date: "...", to_date: "...")
   → show the user available dates and times with direct booking links
```

You can also skip step 2 and go directly from `discover_destination` to `check_availability` if the user already selected a tour from the featured list.

---

## Attribution

All `url` and `booking_url` fields in every tool response automatically include `?ref=<your_username>` so bookings originating from your agent are tracked and credited to your account. Do not strip or modify these parameters.

---

## Reference

- MCP specification: https://modelcontextprotocol.io
- Python SDK: https://pypi.org/project/mcp/
- TypeScript SDK: https://www.npmjs.com/package/@modelcontextprotocol/sdk
