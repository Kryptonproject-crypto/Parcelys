import { useEffect, useState, type FormEvent } from 'react';
import type { AppContext } from '../App';
import { ApiError, createSupportTicket, fetchSupportContext, OfflineError, type SupportContext } from '../lib/api';
import { LIMITES_TEXTE, PIECE_JOINTE, RUBRIQUES_SUPPORT } from '@commun/support';
import { Banner, Button, Field, Header, Input, Select, Textarea } from '../components/ui';

/**
 * Écrire au support depuis le téléphone.
 *
 * Nom, adresse et numéro client viennent du serveur, pas d'une saisie : il
 * les reprendrait de la session de toute façon. La demande ne part qu'avec du
 * réseau — elle a besoin du numéro attribué par le serveur, et une pièce
 * jointe ne se met pas en file d'attente.
 */
export function ContactScreen({ context, sujet = '' }: { context: AppContext; sujet?: string }) {
  const { back, navigate, online, session } = context;
  const [ctx, setCtx] = useState<SupportContext | null>(null);
  const [farmId, setFarmId] = useState('');
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [champs, setChamps] = useState<Record<string, string>>({});
  const [envoye, setEnvoye] = useState<{ number: string | null; id: string | null } | null>(null);

  useEffect(() => {
    if (!online) return;
    void fetchSupportContext(session)
      .then((c) => {
        setCtx(c);
        setFarmId(c.farms.find((f) => f.id === c.activeFarmId)?.id ?? c.farms[0]?.id ?? '');
      })
      .catch(() => undefined);
  }, [online, session]);

  const numero = ctx?.technicianNumber ?? ctx?.farms.find((f) => f.id === farmId)?.customerNumber ?? null;

  async function envoyer(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErreur(null);
    setChamps({});
    const data = new FormData(event.currentTarget);
    const fichier = data.get('piece');
    if (fichier instanceof File && fichier.size === 0) data.delete('piece');
    if (fichier instanceof File && fichier.size > PIECE_JOINTE.maxOctets) {
      setChamps({ piece: 'Fichier trop volumineux : 5 Mo au maximum.' });
      return;
    }
    if (farmId) data.set('farmId', farmId);
    setBusy(true);
    try {
      const r = await createSupportTicket(session, data);
      setEnvoye({ number: r.number, id: r.id });
    } catch (error) {
      if (error instanceof OfflineError) setErreur('Pas de réseau : la demande n’est pas partie. Réessayez avec une connexion.');
      else if (error instanceof ApiError) {
        setErreur(error.message);
        setChamps(error.fieldErrors);
      } else setErreur('Envoi impossible.');
    } finally {
      setBusy(false);
    }
  }

  if (envoye) {
    return (
      <div className="flex min-h-full flex-col bg-canvas">
        <Header title="Demande envoyée" onBack={back} />
        <div className="flex-1 space-y-4 px-4 py-4">
          <Banner tone="success">
            Votre demande {envoye.number ? <strong className="font-mono">{envoye.number}</strong> : null} est enregistrée.
            Vous serez prévenu de la réponse.
          </Banner>
          {envoye.id ? (
            <Button full onClick={() => navigate({ name: 'demande', ticketId: envoye.id ?? '' })}>
              Suivre ma demande
            </Button>
          ) : null}
          <Button full variant="secondary" onClick={back}>
            Retour
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col bg-canvas">
      <Header title="Contacter le support" onBack={back} />
      <form onSubmit={envoyer} className="flex-1 space-y-4 px-4 py-4">
        {!online ? (
          <Banner tone="warning">Hors ligne : une demande ne peut partir qu&apos;avec du réseau.</Banner>
        ) : null}
        {ctx ? (
          <div className="rounded-xl bg-surface-2 px-3.5 py-3 text-[14px] text-ink-2">
            <p>
              {ctx.name} · {ctx.email}
            </p>
            <p className="mt-1">
              Numéro client : <strong className="font-mono text-ink">{numero ?? 'aucun'}</strong>
            </p>
          </div>
        ) : null}
        {ctx && !ctx.technicianNumber && ctx.farms.length > 1 ? (
          <Field label="Exploitation concernée">
            <Select value={farmId} onChange={(event) => setFarmId(event.target.value)}>
              {ctx.farms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                  {f.customerNumber ? ` — ${f.customerNumber}` : ''}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label="Sujet" required error={champs.subject}>
          <Input name="subject" required minLength={3} maxLength={LIMITES_TEXTE.sujet} defaultValue={sujet} />
        </Field>
        <Field label="Page ou fonctionnalité concernée" error={champs.area}>
          <Select name="area" defaultValue="mobile">
            {RUBRIQUES_SUPPORT.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Description"
          required
          error={champs.description}
          hint="Ce que vous faisiez, ce que vous attendiez, ce qui s'est produit."
        >
          <Textarea name="description" rows={6} required minLength={10} maxLength={LIMITES_TEXTE.description} />
        </Field>
        <Field label="Pièce jointe" error={champs.piece} hint="Facultatif — photo ou capture : PNG, JPEG, WebP, PDF ou texte, 5 Mo au plus.">
          <input name="piece" type="file" accept={PIECE_JOINTE.accept} className="block w-full text-sm text-ink-2" />
        </Field>
        {erreur ? <Banner tone="danger">{erreur}</Banner> : null}
        <Button type="submit" full loading={busy} disabled={!online}>
          Envoyer la demande
        </Button>
      </form>
    </div>
  );
}
