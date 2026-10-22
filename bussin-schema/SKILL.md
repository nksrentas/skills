---
name: bussin-schema
description: Detect, validate or generate Schema.org JSON-LD and keep it eligible for Google rich results, with an up-to-date list of active, restricted and deprecated types (FAQ rich results retired in May 2026). Load it whenever a page needs structured data - Organization, BreadcrumbList, Article, Product, LocalBusiness, Event and more - when building a public page with bussin-seo, or when asked about schema markup, rich results or JSON-LD.
user-invocable: true
argument-hint: "[page, entity or URL]"
license: MIT
---

# Schema Markup Analysis & Generation

Adapted from [AgriciDaniel/claude-seo](https://github.com/AgriciDaniel/claude-seo) `seo-schema` (MIT, commit 4b99de2, see `license.txt`), with its `schema-types.md` reference. The house rules near the end are this repository's additions.

## Detection

1. Extract JSON-LD from the rendered page source: fetch the page (or read the
   built HTML), collect every `<script type="application/ld+json">` block, and
   parse each one as JSON. A block that does not parse is an error. Flag any
   block without `@context` or `@type`: Google cannot attach it to an entity (a
   rating in such a block does not reach the Product).
2. Check for Microdata (`itemscope`, `itemprop`)
3. Check for RDFa (`typeof`, `property`)
4. Always recommend JSON-LD as primary format (Google's stated preference)

## Validation

- Check required properties per schema type
- Validate against Google's supported rich result types
- Test for common errors:
  - Missing @context
  - Invalid @type
  - Wrong data types
  - Placeholder text
  - Relative URLs (should be absolute)
  - Invalid date formats
- Flag deprecated types (see below)

## Schema Type Status (as of June 2026)

Read `references/schema-types.md` for the full list. Key rules:

### ACTIVE (recommend freely):
Organization, LocalBusiness, SoftwareApplication, WebApplication, Product (with Certification markup as of April 2025), ProductGroup, Offer, Service, Article, BlogPosting, NewsArticle, Review, AggregateRating, BreadcrumbList, WebSite, WebPage, Person, ProfilePage, ContactPage, VideoObject, ImageObject, Event, JobPosting, Course, DiscussionForumPosting

### VIDEO & SPECIALIZED (recommend freely):
BroadcastEvent, Clip, SeekToAction, SoftwareSourceCode

See `schema/templates.json` for ready-to-use JSON-LD templates for these types.

> **JSON-LD and JavaScript rendering:** Google supports structured data generated with JavaScript, but its "Generate structured data with JavaScript" guide (last updated 2025-12-10) warns that dynamically generated Product markup can make Shopping crawls less frequent and less reliable for fast-changing price and availability. For time-sensitive markup (especially Product, Offer), include JSON-LD in the initial server-rendered HTML.

### NO RICH RESULTS, KEEP IF USEFUL:
- **FAQPage**: Google retired FAQ rich results for ALL sites on May 7, 2026 (supersedes the Aug 2023 gov/health restriction). No Google SERP rich-result benefit; flag existing FAQPage at Info (not Critical) rather than removal. For genuine user Q&A pages, use **QAPage**.

### DEPRECATED (never recommend):
- **HowTo**: Rich results removed September 2023
- **SpecialAnnouncement**: Deprecated July 31, 2025
- **CourseInfo, EstimatedSalary, LearningVideo**: Retired June 2025
- **ClaimReview**: No Search rich result since June 2025. Google's Fact Check Explorer still uses the markup, so fact-checking publishers may keep it; never recommend it for SERP features
- **VehicleListing**: Retired from rich results June 2025
- **Practice Problem**: Deprecation notice 2025-11-05; tooling support removed starting January 2026; documentation removed 2026-01-06
- Search Console / Rich Results Test / appearance-filter support for CourseInfo, ClaimReview, EstimatedSalary, LearningVideo, SpecialAnnouncement, VehicleListing was removed 2025-09-09 (Search Console API through December 2025).

### Still supported (despite earlier phase-out notices):
- **Book Actions**: NOT deprecated. The June 2025 phase-out banner was removed on 2025-11-05 because a Search feature still uses the markup.

### Supported for Dataset Search only:
- **Dataset**: Not discontinued; consumed by Google Dataset Search, with no Google Search rich-result surface. Don't advise removal as if it were killed.

### Still supported (do not flag):
- QAPage (expanded comment-thread properties 2026-03-24), DiscussionForumPosting, Education Q&A (Quiz / `eduQuestionType=Flashcard`). For e-commerce, **hasAdultConsideration** (added 2026-05-20; value `https://schema.org/SexualContentConsideration`) is required for adult products. `Product.category` accepts `Text`, `CategoryCode`, or arrays mixing both.

## Generation

When generating schema for a page:
1. Identify page type from content analysis
2. Select appropriate schema type(s)
3. Generate valid JSON-LD with all required + recommended properties
4. Include only truthful, verifiable data. Use placeholders clearly marked for user to fill
5. Validate output before presenting
6. For review markup, reject fake reviews and undisclosed incentivized reviews.
   An incentive must be clearly and prominently disclosed on the page.

## Common Schema Templates

### Organization
```json
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "[Company Name]",
  "url": "[Website URL]",
  "logo": "[Logo URL]",
  "contactPoint": {
    "@type": "ContactPoint",
    "telephone": "[Phone]",
    "contactType": "customer service"
  },
  "sameAs": [
    "[Facebook URL]",
    "[LinkedIn URL]",
    "[Twitter URL]"
  ]
}
```

### LocalBusiness
```json
{
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "name": "[Business Name]",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "[Street]",
    "addressLocality": "[City]",
    "addressRegion": "[State]",
    "postalCode": "[ZIP]",
    "addressCountry": "US"
  },
  "telephone": "[Phone]",
  "openingHours": "Mo-Fr 09:00-17:00",
  "geo": {
    "@type": "GeoCoordinates",
    "latitude": "[Lat]",
    "longitude": "[Long]"
  }
}
```

### Article/BlogPosting
```json
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "[Title]",
  "author": {
    "@type": "Person",
    "name": "[Author Name]"
  },
  "datePublished": "[YYYY-MM-DD]",
  "dateModified": "[YYYY-MM-DD]",
  "image": "[Image URL]",
  "publisher": {
    "@type": "Organization",
    "name": "[Publisher]",
    "logo": {
      "@type": "ImageObject",
      "url": "[Logo URL]"
    }
  }
}
```

## House rules for this stack

- Build JSON-LD objects in the feature folder, in `<feature>.jsonld.ts` (not `<feature>.schema.ts`, which is the Drizzle schema in `bussin-ts-architecture`), typed with `schema-dts` when the project has it.
- Render them from a server component, escaping `<` so content cannot close the script tag:

```tsx
<script
  type="application/ld+json"
  dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
/>
```

- `Organization` and `WebSite` go once, in the root layout; page types (`Article`, `Product`, `BreadcrumbList`, ...) go in that page.
- Markup describes only what is visible on the page: same names, prices, dates and breadcrumbs.
- Validate changed pages with Google's Rich Results Test or the Schema Markup Validator before calling the work done.

## Review checklist

Copy these into `CODING_STANDARDS.md` when bussin-autoloop loads this skill:

- JSON-LD lives in `<feature>.jsonld.ts` and is rendered server-side with `<` escaped.
- No deprecated or retired types (see `references/deprecated-types-2024-2026.md`).
- Required properties present for each type; values match visible content.
- One `Organization` and `WebSite` site-wide; `BreadcrumbList` matches the visible breadcrumb.

## Output

- `SCHEMA-REPORT.md`: detection and validation results
- `generated-schema.json`: ready-to-use JSON-LD snippets

### Validation Results
| Schema | Type | Status | Issues |
|--------|------|--------|--------|
| ... | ... | ✅/⚠️/❌ | ... |

### Recommendations
- Missing schema opportunities
- Validation fixes needed
- Generated code for implementation

## Error Handling

| Scenario | Action |
|----------|--------|
| URL unreachable | Report connection error with status code. Suggest verifying URL and checking if the page requires authentication. |
| No schema markup found | Report that no JSON-LD, Microdata, or RDFa was detected. Recommend appropriate schema types based on page content analysis. |
| Invalid JSON-LD syntax | Parse and report specific syntax errors (missing brackets, trailing commas, unquoted keys). Provide corrected JSON-LD output. |
| Deprecated schema type detected | Flag the deprecated type with its retirement date. Recommend the current replacement type or advise removal if no replacement exists. |
