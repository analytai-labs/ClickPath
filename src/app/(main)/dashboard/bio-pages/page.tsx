import { redirect } from "next/navigation";

// Bio pages are one template among several now. Kept so old bookmarks work.
export default function BioPagesRedirect() {
  redirect("/dashboard/templates");
}
