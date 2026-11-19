import { redirect } from "next/navigation";

// The create-team form lives on `/` now, under the team list. The route stays so
// old links land somewhere, and `new` stays a reserved slug so it can.
export default function NewTeamPage() {
  redirect("/");
}
