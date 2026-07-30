# Template registry

Template pages (`/p/<slug>`) are **registry-based and code-only**. There is no
template builder and no dynamic templates — every template is declared in this
folder and ships with the app.

One `TemplatePage` row backs every template. The `templateType` column selects
the template; `templateData` holds its JSON content (or, for `bio`, content
lives in `BioBlock` rows instead).

## Adding a template

Five steps. Nothing outside this list should need editing — no `if
(templateType === …)` branches anywhere.

1. **Prisma enum** — add the member to `enum TemplateType` in
   `prisma/schema.prisma` and create a migration.

2. **Definition** — add `src/lib/templates/definitions/<id>.ts` exporting a
   `TemplateDefinition`: label, description, icon key, content model, zod schema
   for `templateData`, default data, styling variants, and `deriveTitle`.

3. **Registry** — add the entry to `TEMPLATE_DEFINITIONS` in `registry.ts`. The
   map is keyed by the Prisma enum, so a missing entry is a type error.

4. **Renderer** — add `src/components/templates/<id>/…` with a presentational
   renderer plus a public view, and register it in
   `src/components/templates/registry.tsx` (which also maps the icon key). The
   renderer is shared by the builder preview and the public page so the two can
   never drift.

5. **Editor** — add the editor body under
   `src/app/(main)/dashboard/templates/[id]/_components/<id>/` and register it in
   `.../_components/editor-registry.tsx`. The editor only supplies the Content
   and Design tab bodies; the shell (header, publish toggle, save, Settings and
   Analytics tabs, phone preview) is shared.

## What is already generic

- **Routing** — `/dashboard/templates/[id]` for the editor; publicly, a page is
  served from `<platform>/p/<slug>`, from `<customer domain>/p/<slug>` for any
  domain verified in the owning workspace, and optionally from a domain's root.
  `src/lib/templates/page-url.ts` decides which of those is canonical.
- **Domain portability** — because *any* verified workspace domain serves *all*
  of that workspace's pages, the platform domain is replaceable without
  breaking published pages or printed QR codes.
- **QR code** — every page gets the full QR designer (styles, colors, effects,
  logo, saved presets), persisted in `qrDesign`, always encoding the page's
  canonical URL.
- **Page settings** — handle, title, description, public domain, social preview
  image, SEO fields and branding removal work for every template.
- **Styling variants** — `theme.preset` stores the variant id; the server
  validates it against the definition's `variants`.
- **Images** — any base64 data URL anywhere inside `templateData` is uploaded to
  R2 on save, and R2 objects that fall out of the document (or whose page is
  deleted) are removed. Templates do not implement upload handling.
- **Analytics, plan limits, workspace scoping, publish/unpublish and deletion.**
