import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export const metadata: Metadata = {
  title: "Privacy and recovery guide — Mithaq",
  description:
    "Where credentials are stored, what a submitted proof makes public, how to back up, and what issuer revocation means.",
};

const SECTIONS = ["storage", "visibility", "backup", "revocation"] as const;

export default async function PrivacyGuidePage() {
  const t = await getTranslations("privacyGuide");
  return (
    <main className="reveal" style={{ maxWidth: 720, margin: "0 auto", padding: "3rem 1.5rem" }}>
      <h1>{t("title")}</h1>
      <p className="muted">{t("intro")}</p>
      {SECTIONS.map((id) => (
        <section key={id} id={id} style={{ marginTop: "2rem" }}>
          <h2>{t(`${id}.heading`)}</h2>
          <p>{t(`${id}.body`)}</p>
        </section>
      ))}
    </main>
  );
}
