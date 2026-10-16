'use client';

import { useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { apiFetch, ApiRequestError } from '@/lib/client/api';
import { LIMITES_TEXTE, PIECE_JOINTE, RUBRIQUES_SUPPORT } from '@/lib/shared/support';
import { Alert, Button, Field, Input, Select, Textarea } from '@/components/ui';
import { IconAttachment, IconSend, IconSuccess } from '@/components/ui/icons';

export type ContexteContact = {
  /** Compte connecté : nom, adresse et numéros viennent du serveur. */
  compte: {
    name: string;
    email: string;
    technicianNumber: string | null;
    farms: Array<{ id: string; name: string; customerNumber: string | null }>;
    activeFarmId: string | null;
  } | null;
};

/**
 * Formulaire de contact.
 *
 * Connecté : nom, adresse et numéro client sont affichés, pas saisis — le
 * serveur les reprend de la session et ignorerait toute autre valeur. Le
 * choix de l'exploitation se limite aux siennes.
 *
 * Non connecté : nom et adresse obligatoires, numéro client facultatif. Le
 * numéro sert à acheminer la demande ; il ne prouve rien, et l'écran le dit.
 */
export function ContactForm({
  contexte,
  sujetInitial = '',
}: {
  contexte: ContexteContact;
  sujetInitial?: string;
}) {
  const { compte } = contexte;
  const [farmId, setFarmId] = useState(
    compte?.farms.find((f) => f.id === compte.activeFarmId)?.id ?? compte?.farms[0]?.id ?? '',
  );
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [champs, setChamps] = useState<Record<string, string>>({});
  const [envoye, setEnvoye] = useState<{ number: string | null; id: string | null; message: string } | null>(null);
  const fichierRef = useRef<HTMLInputElement>(null);

  const numero = compte
    ? compte.technicianNumber ?? compte.farms.find((f) => f.id === farmId)?.customerNumber ?? null
    : null;

  async function envoyer(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErreur(null);
    setChamps({});
    const form = event.currentTarget;
    const data = new FormData(form);
    const fichier = data.get('piece');
    if (fichier instanceof File && fichier.size > PIECE_JOINTE.maxOctets) {
      setChamps({ piece: 'Fichier trop volumineux : 5 Mo au maximum.' });
      return;
    }
    if (fichier instanceof File && fichier.size === 0) data.delete('piece');
    if (compte && farmId) data.set('farmId', farmId);

    setBusy(true);
    try {
      const result = await apiFetch<{ message: string; number: string | null; id: string | null }>(
        '/api/support/tickets',
        { method: 'POST', body: data },
      );
      setEnvoye(result);
      form.reset();
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setErreur(error.message);
        setChamps(error.fieldErrors);
      } else {
        setErreur('Envoi impossible : vérifiez votre connexion et réessayez.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (envoye) {
    return (
      <div className="rounded-2xl border border-champ-500/40 bg-champ-50/60 p-6 dark:bg-champ-900/25">
        <p className="flex items-center gap-2 text-[17px] font-semibold text-ink">
          <IconSuccess size={20} aria-hidden className="text-champ-700 dark:text-champ-300" />
          Demande envoyée
          {envoye.number ? <span className="font-mono">{envoye.number}</span> : null}
        </p>
        <p className="mt-2 text-[14.5px] text-ink-2">{envoye.message}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          {envoye.id ? (
            <Link
              href={`/mes-demandes/${envoye.id}`}
              className="inline-flex min-h-11 items-center rounded-lg bg-champ-700 px-5 font-medium text-white hover:bg-champ-800"
            >
              Suivre ma demande
            </Link>
          ) : null}
          <Button variant="outline" onClick={() => setEnvoye(null)}>
            Envoyer une autre demande
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={envoyer} className="space-y-4" noValidate>
      {compte ? (
        <div className="rounded-lg bg-surface-2 px-4 py-3 text-sm text-ink-2">
          <p>
            Envoyé par <strong className="text-ink">{compte.name}</strong> ({compte.email})
          </p>
          <p className="mt-1">
            Numéro client :{' '}
            <strong className="font-mono text-ink">{numero ?? 'aucun'}</strong>
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Votre nom" htmlFor="contact-name" required error={champs.name}>
            <Input id="contact-name" name="name" autoComplete="name" required maxLength={120} />
          </Field>
          <Field label="Votre adresse e-mail" htmlFor="contact-email" required error={champs.email}>
            <Input id="contact-email" name="email" type="email" autoComplete="email" required />
          </Field>
          <Field
            label="Numéro client"
            htmlFor="contact-number"
            hint="Facultatif — EXP-… ou TEC-…, dans Mon profil. Il aide à vous retrouver, il ne prouve pas votre identité."
            error={champs.customerNumber}
          >
            <Input id="contact-number" name="customerNumber" placeholder="EXP-000123" maxLength={24} autoComplete="off" />
          </Field>
        </div>
      )}

      {compte && !compte.technicianNumber && compte.farms.length > 1 ? (
        <Field label="Exploitation concernée" htmlFor="contact-farm">
          <Select id="contact-farm" value={farmId} onChange={(event) => setFarmId(event.target.value)}>
            {compte.farms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
                {f.customerNumber ? ` — ${f.customerNumber}` : ''}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Sujet" htmlFor="contact-subject" required error={champs.subject}>
          <Input
            id="contact-subject"
            name="subject"
            required
            minLength={3}
            maxLength={LIMITES_TEXTE.sujet}
            defaultValue={sujetInitial}
          />
        </Field>
        <Field label="Page ou fonctionnalité concernée" htmlFor="contact-area" error={champs.area}>
          <Select id="contact-area" name="area" defaultValue="">
            <option value="">— Choisir —</option>
            {RUBRIQUES_SUPPORT.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field
        label="Description détaillée"
        htmlFor="contact-description"
        required
        error={champs.description}
        hint="Ce que vous faisiez, ce que vous attendiez, ce qui s'est produit. Précisez la parcelle et la date si c'est utile."
      >
        <Textarea
          id="contact-description"
          name="description"
          rows={7}
          required
          minLength={10}
          maxLength={LIMITES_TEXTE.description}
        />
      </Field>

      <Field
        label="Pièce jointe"
        htmlFor="contact-piece"
        error={champs.piece}
        hint="Facultatif — capture d'écran ou document : PDF, PNG, JPEG, WebP ou texte, 5 Mo au plus."
      >
        <div className="flex items-center gap-2">
          <IconAttachment size={16} aria-hidden className="shrink-0 text-ink-3" />
          <input
            ref={fichierRef}
            id="contact-piece"
            name="piece"
            type="file"
            accept={PIECE_JOINTE.accept}
            className="block w-full text-sm text-ink-2 file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm file:text-ink"
          />
        </div>
      </Field>

      {/* Champ piège : invisible pour un humain, rempli par un robot. */}
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label htmlFor="contact-website">Site web</label>
        <input id="contact-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      {!compte ? (
        <Alert tone="info">
          Sans connexion, nous ne pouvons pas vérifier votre identité : nous vous écrirons à
          l&apos;adresse indiquée, avec un lien pour suivre la demande, mais ne communiquerons
          aucune donnée de compte avant vérification.{' '}
          <Link href="/connexion" className="font-medium underline">
            Se connecter
          </Link>{' '}
          simplifie tout.
        </Alert>
      ) : null}

      {erreur ? <Alert tone="danger">{erreur}</Alert> : null}

      <div className="flex justify-end">
        <Button type="submit" size="lg" icon={IconSend} loading={busy}>
          Envoyer la demande
        </Button>
      </div>
    </form>
  );
}
