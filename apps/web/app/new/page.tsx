import { redirect } from "next/navigation";

// The create-org form lives on `/` now, under the org list. The route stays so
// old links land somewhere, and `new` stays a reserved slug so it can.
export default function NewOrgPage() {
  redirect("/");
}
