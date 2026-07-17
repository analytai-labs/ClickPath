import { redirect } from "next/navigation";

export default function CreateQRCodeRedirectPage() {
  redirect("/dashboard/link/new?tab=qr&isQrCodeOnly=true");
}
