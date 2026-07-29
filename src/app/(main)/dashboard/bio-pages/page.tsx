import { redirect } from "next/navigation";

// /dashboard/bio-pages is now merged into /dashboard/templates.
// Redirect to keep any bookmarks working.
export default function BioPagesRedirect() {
  redirect("/dashboard/templates");
}
