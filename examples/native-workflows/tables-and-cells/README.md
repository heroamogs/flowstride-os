# Search tables, target cells and reuse their values

Flowstride can interact with a table through readable controls, exact selectors or indexed coordinates. It can extract a cell's text and use it in another page in the same test.

| Requirement | Value |
| --- | --- |
| Engine | OS or Cloud |
| Browser | Chromium, Firefox or WebKit |
| Application | Shared local demo |
| Cloud account | Optional |

Complete the [shared setup](../README.md) and leave the demo application running.

## Search, choose an action and reuse a cell

The demo has two orders: FS-101 is Pending and FS-102 is Approved. Its search control hides unmatched rows; selecting a row or its View button opens that order's details.

[search-extract-reuse.flow](flows/search-extract-reuse.flow):

```flow
Feature: Table and cell reuse
Scenario: Search, extract and reuse a table value
Given "The orders table is open"
  flow.open "/orders";
When "Find the approved order"
  flow.type input "Search orders" "FS-102";
  flow.assert.that {
    "selector": "#orders tbody tr:not([hidden])",
    "condition": "count",
    "value": 1
  };
  flow.assert.that {
    "selector": "#orders tbody tr:has(td:text-is('FS-102')) td:nth-child(3)",
    "condition": "text",
    "value": "Approved"
  };
When "Extract the order and open its row action"
  flow.extract text "table[0] tr[2] td[0]" as "selectedOrder";
  flow.click button "View" inside "table[0] tr[2] td[3]";
And "The selected order is shown"
  flow.expect text "Order @selectedOrder";
When "Reuse the cell on another page"
  flow.open "/reuse";
  flow.type input "Selected value" "@selectedOrder";
  flow.click button "Apply value";
Then "The reused value remains correct"
  flow.expect text "Selected FS-102";
```

```sh
npx flowstride run workflow-examples/tables-and-cells/flows/search-extract-reuse.flow --ci
```

Expected: one visible matching row, Approved in the selected status cell, `Order FS-102` after the exact row action, and `Selected FS-102` after navigation and reuse. The run exits `0`.

`flow.type` uses the application's search input. The application implements filtering. The assertion excludes rows hidden by this fixture's `hidden` attribute; adapt it if your app removes rows or uses another hiding mechanism.

The extraction stores the text as `@selectedOrder`. Extraction itself does not assert that the value is correct; the following outcome checks do.

## Indexed table/cell targets

[coordinates.flow](flows/coordinates.flow) demonstrates direct cell selection and a repeated button inside an exact cell:

```flow
Feature: Table coordinates and exact cell actions

  Scenario: Select a cell and a repeated row action
    Given "The unfiltered orders table is open"
      flow.open "/orders";

    When "Select the first cell of the second data row"
      flow.click "table[0] tr[2] td[0]";

    And "The second order is selected"
      flow.expect text "Order FS-102";

    When "Click the button in the first data row's action cell"
      flow.click button "View" inside "table[0] tr[1] td[3]";

    Then "The first order is selected"
      flow.expect text "Order FS-101";
```

```sh
npx flowstride run workflow-examples/tables-and-cells/flows/coordinates.flow --ci
```

Expected: clicking `table[0] tr[2] td[0]` selects FS-102, then clicking View in the first data row's action cell selects FS-101.

| Target | Meaning in this fixture |
| --- | --- |
| `table[0]` | First table |
| `table[0] tr[0]` | Header row |
| `table[0] tr[1]` | First data row |
| `table[0] tr[2] td[0]` | First data cell of the second data row |
| `table[0] tr[1] td[3]` | Action cell of the first data row |

Indexes are zero-based. Header rows count as rows, and hidden matching DOM rows can still affect indexes. CSS `nth-child` positions, used in the status assertion, are one-based.

## Deliberate failure

```sh
npx flowstride run workflow-examples/tables-and-cells/negative/wrong-cell-value.flow --ci
```

That file expects Rejected where the fixture contains Approved. It must fail, retain evidence and exit nonzero.

## Adapting to changing tables

For sorted, filtered or paginated tables, prefer a stable record identifier when position is not what you are testing. For example:

```flow
flow.click "#orders tbody tr:has(td:text-is('FS-102')) button";
```

The match must identify the intended record uniquely. Pagination, virtual scrolling and data loading remain application behavior: navigate or load the row before targeting it. An indexed HTML-table helper is not a universal query language for every virtual grid or ARIA treegrid.

See the [table reference](https://docs.flowstride.io/flow-language/flow-elements/table) and [variable reuse](../variables-and-reuse/README.md).
