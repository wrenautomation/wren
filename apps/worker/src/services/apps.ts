/**
 * The portal's product apps: voice, templates, notes, sites, payments, documents, journeys and
 * the pipeline console.
 */
import { githubRepo } from "@wren/core/github";
import { makeTemplatesConsole } from "@wren/core/templates/console";
import { s3Files } from "@wren/delivery/files";
import { makeDocumentsConsole } from "@wren/documents/console";
import { documenso } from "@wren/documents/documenso";
import { makeDocuments } from "@wren/documents/service";
import { makeNotesConsole } from "@wren/notes/console";
import { makePaymentsConsole } from "@wren/payments/console";
import { makePayReconcile } from "@wren/payments/reconcile";
import { makePayments } from "@wren/payments/service";
import { makePipelineConsole } from "@wren/pipeline/console";
import { makeJourneys } from "@wren/pipeline/restate";
import { makeSitesConsole } from "@wren/sites/console";
import { makeSites } from "@wren/sites/service";
import { makeVoiceConsole } from "@wren/voice/console";
import type { AnyService, Deps } from "./deps.js";

/** The apps domain's services, in the order they were served from `services.ts`. */
export function appsServices(deps: Deps): AnyService[] {
  const {
    bookerMailer,
    clientDb,
    db,
    fireAll,
    keys,
    llm,
    notesDeps,
    notify,
    openClient,
    settings,
  } = deps;
  // E-signature for sealed documents lives in Documenso when both of its settings are set.
  const esign =
    settings.documensoUrl && settings.documensoToken
      ? documenso({ url: settings.documensoUrl, token: settings.documensoToken })
      : null;
  const sealedFiles = settings.filesBucket ? s3Files({ bucket: settings.filesBucket }) : null;
  const payDeps = {
    main: db,
    open: openClient,
    keys,
    fetch: (url: string, init: RequestInit) => fetch(url, init),
    portal: settings.portalOrigin ?? "https://app.wrenautomation.com",
  };
  const services: AnyService[] = [
    // The voice agent's portal writes: test calls saved (designs/2026-10-06-voice-agent.md).
    makeVoiceConsole({ db }),
    // The Library's templates: save, publish (copy that sends waits in To approve), approve.
    makeTemplatesConsole({ db }),
    // Notes: docs in every workspace, Yjs in each one's own database (designs/2026-10-07-notes.md).
    makeNotesConsole(notesDeps),
    // Sites: offer landers as data at /o/<slug>, code pages by URL, one tracker and form into the
    // door (designs/2026-10-07-sites.md). Claude drafts copy only where a real model runs.
    makeSites({ main: db, shareKey: settings.siteExportToken ?? null, open: clientDb }),
    makeSitesConsole({
      db,
      shareKey: settings.siteExportToken ?? null,
      write: settings.llm === "fake" ? null : (p) => llm.complete(p).then((r) => r.text),
    }),
    // Text-to-pay on the client's own Stripe key (designs/2026-10-07-forms-and-pay.md), and its
    // daily reconcile against Stripe, which tells the executor what a dropped webhook missed.
    makePayments({ ...payDeps, mailer: bookerMailer, fire: fireAll }),
    makePaymentsConsole(payDeps),
    makePayReconcile({ ...payDeps, mailer: bookerMailer, fire: fireAll, ...notify }),
    // Contracts, proposals and estimates to sign; a deposit on the same Stripe key
    // (designs/2026-10-09-documents.md).
    makeDocuments({
      ...payDeps,
      mailer: bookerMailer,
      fire: fireAll,
      documenso: esign,
      files: sealedFiles,
    }),
    makeDocumentsConsole({ ...payDeps, files: sealedFiles, sealed: !!esign && !!sealedFiles }),
    // Journeys: hand moves through the shape's own step, and the pipeline records
    // (designs/2026-10-18-journeys.md).
    makeJourneys({ db: (client) => (client ? clientDb(client) : db) }),
    makePipelineConsole({
      db,
      open: openClient,
      // The shape's git mirror: a private repo, off without its token (designs/2026-10-19-business-map.md).
      shapes: settings.shapesGithubToken
        ? {
            files: githubRepo({
              token: settings.shapesGithubToken,
              repo: settings.shapesGithubRepo,
              api: settings.shapesGithubApi,
            }),
            repo: settings.shapesGithubRepo,
          }
        : null,
    }),
  ];
  return services;
}
