# Cockpit S3 — Licensing

> [!IMPORTANT]
> **This is a summary of terms, not the license agreement.** The binding commercial license agreement is provided at purchase. This summary is pending legal review and may change; if it conflicts with the signed agreement, the agreement prevails.

Cockpit S3 is **dual-licensed**. You choose one of the two options below.

## 1. Open source — GNU AGPL v3

The source code is free under the [GNU Affero General Public License v3.0 or later](./LICENSE) (`AGPL-3.0-or-later`). This is the **Community** edition.

Under the AGPL you **may** use, study, modify and redistribute the software at no cost, including running it for your own organization, **provided that**:

- derivative works are also licensed under the AGPL v3 (or later);
- **network clause (§13):** if you modify the software and let users interact with it over a network, you must offer those users the complete corresponding source code of the version you run, including your modifications.

If these terms work for you, you need nothing else.

## 2. Commercial license

A commercial license **replaces the AGPL obligations** for the licensee: you can run, modify and integrate Cockpit S3 without publishing your modifications. It also unlocks the Pro or Enterprise features through a license key.

Typical reasons to buy one:

- your legal department does not allow AGPL software;
- you modify Cockpit S3 and do not want to publish the changes;
- you need SSO, audit export, branding or white-label;
- you need support, an SLA, or invoice/PO payment;
- you want to redistribute, embed (OEM) or offer Cockpit S3 to third parties (Enterprise only).

### Editions

| | **Community** | **Pro** | **Enterprise** |
| --- | --- | --- | --- |
| License | AGPL-3.0-or-later | Commercial | Commercial, negotiated |
| Price | Free | US$ 390/year per production Instance, or US$ 39/month. Staging/dev Instances free. Founder pricing: US$ 190/year locked for life for the first 30 customers. | From US$ 1,490/year |
| Features | Full core: unlimited users, permission matrix + folder overrides, expiring/IP-locked share links, previews + spreadsheet editor, audit log in the UI, Garage admin, multiple S3 connections, encryption at rest, DR backup | Community + SSO via OIDC, audit export (CSV/JSON) with retention and webhook/syslog forwarding, basic branding | Pro + full white-label, SAML/SCIM (built on demand), high availability (roadmap) |
| Support | Community (GitHub) | Email, 2 business days | Priority support, SLA |
| Redistribution / OEM / SaaS to third parties | Under AGPL terms only | No | Yes, as agreed |

Pricing and feature details: [README → Editions & pricing](./README.md#pricing).

### Definitions

- **Instance** — one running deployment of Cockpit S3 serving one production environment, identified by its database and its public URL. For Enterprise high-availability setups, any number of replicas behind one URL and sharing one database count as **one** Instance.
- **Production Instance** — an Instance used by real users or holding real data. Instances used only for development, testing, staging or evaluation are not production Instances and do not need a paid license; they may run with the same license key.
- **Licensee** — the legal entity named on the license key and invoice.
- **Term** — the period the license is paid for (one year, or one month for monthly Pro), starting on the issue date.

### Scope of use

- **Pro:** internal use by the Licensee and its affiliates, including giving access to the Licensee's own employees, contractors, customers and partners through the Licensee's Instance (for example, sharing files with clients).
- **Not included in Pro:** redistributing Cockpit S3, embedding it in a product sold or delivered to others (OEM), or operating it as a service for third parties who manage their own workspaces (SaaS / hosting / managed service). These rights are available **only under an Enterprise agreement**.
- The license is not transferable without written consent, except as part of a merger or acquisition of the Licensee.

### Term, renewal and updates

- Licenses are **annual** (Pro monthly is also available) and renew on request; renewal is not automatic unless agreed.
- During the Term, the Licensee may install **every release published during the Term**, including security fixes and new features of the purchased edition.
- Founder pricing is locked for life: renewals stay at the founder rate.

### What happens on expiry

- The Instance **keeps running**. Pro/Enterprise features **stay active on releases published during the Term**, and the commercial license for those releases remains in force (perpetual use of those versions).
- Releases published **after** the Term ends do not activate the Pro/Enterprise features with the expired key; upgrading to them requires renewal. Without renewal, newer releases run as the Community edition under the AGPL.
- Support ends with the Term.

### License keys

License keys are Ed25519-signed and verified **offline** by the Instance. There is no phone-home, activation server or telemetry. The same binary runs every edition. See [`docs/licensing.md`](./docs/licensing.md).

### Warranty and liability

- Except as expressly stated in a contracted SLA, the software is provided **"as is"**, without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose and non-infringement.
- To the maximum extent permitted by law, the licensor's total liability under the commercial license is **limited to the fees paid by the Licensee in the 12 months before the claim**, and the licensor is not liable for indirect, incidental, special or consequential damages, including loss of data, profits or business.
- You are responsible for backing up your data and for the S3 storage you connect.

### Governing law

[to be defined — Brazil]

### How to buy

Online checkout is not live yet. Email **cockpits3@pm.me** with:

- company name and billing details;
- edition (Pro or Enterprise) and number of production Instances;
- for Enterprise: expected use (internal, OEM, SaaS), support and SLA needs.

You receive an invoice, the license agreement and the license key.

---

## Why dual licensing works

All code in this repository is copyrighted by **Lucas Pagliarini**, the sole copyright holder. That allows the same code to be offered under two sets of terms: the community uses it for free under the AGPL, and those who cannot accept copyleft buy the commercial license.

## Contributions

Contributions are accepted under the [Contributor License Agreement](./CLA.md). You keep the copyright in your contribution and grant the copyright holder a perpetual, irrevocable license to distribute it under the AGPL **and** to relicense it under commercial terms. Without that grant a contribution cannot be merged, because it would break the dual-licensing model. The CLA Assistant bot asks for the signature on your first pull request. See [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## Contact

**cockpits3@pm.me**

---

### Nota em português

O Cockpit S3 tem licença dupla: AGPL-3.0-or-later (edição Community, gratuita) ou licença comercial (Pro e Enterprise), que dispensa as obrigações da AGPL e libera os recursos pagos via chave de licença verificada offline. Este documento é um resumo dos termos, pendente de revisão jurídica; o contrato vinculante é entregue na compra. Preços e edições em português: [README.pt-BR.md → Edições e preços](./README.pt-BR.md#pricing). Contato: **cockpits3@pm.me**.
