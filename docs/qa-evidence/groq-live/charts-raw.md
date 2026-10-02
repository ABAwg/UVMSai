```chart
{
  "type": "line",
  "title": "Monthly Data",
  "data": [
    { "label": "Jan", "value": 120 },
    { "label": "Feb", "value": 150 },
    { "label": "Mar", "value": -20 },
    { "label": "Apr", "value": 310 }
  ]
}
```

```chart
{
  "type": "bar",
  "title": "Regional Values",
  "data": [
    { "label": "North", "value": 12 },
    { "label": "South", "value": -4 },
    { "label": "East", "value": 8 }
  ]
}
```

```chart
{
  "type": "pie",
  "title": "Resource Distribution",
  "data": [
    { "label": "Workshops", "value": 50 },
    { "label": "Repairs",   "value": 30 },
    { "label": "Donations", "value": 20 }
  ]
}
```

```chart
{
  "type": "scatter",
  "title": "Sample Points",
  "data": [
    { "label": "A", "x": 1, "y": 2 },
    { "label": "B", "x": 2, "y": 5 },
    { "label": "C", "x": 3, "y": 4 }
  ]
}
```

**Why signed regional values are unsuitable for a pie chart**

A pie chart visualizes parts of a whole, requiring each slice to represent a non‑negative proportion of the total. Negative values (e.g., South = ‑4) have no meaningful share of a whole and would distort the total sum, making the chart misleading or impossible to render correctly. Therefore, a bar chart (which can display positive and negative bars) is appropriate, while a pie chart is not.