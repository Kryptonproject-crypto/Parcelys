'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiDelete, apiPatch, apiPost, ApiRequestError } from '@/lib/client/api';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog, useConfirm } from '@/components/forms/ConfirmDialog';
import { Alert, Badge, Button, Card, CardHeader, Checkbox, Field, Input, Select, Textarea } from '@/components/ui';
import { IconDelete, IconEdit, IconPlus } from '@/components/ui/icons';

type Entree = {
  id: string;
  question: string;
  answer: string;
  keywords: string | null;
  position: number;
  published: boolean;
  needsReview: boolean;
  updatedAt: string;
};

type Categorie = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  position: number;
  entries: Entree[];
};

/**
 * Édition du centre d'aide.
 *
 * Format des réponses : du texte simple — une ligne vide sépare deux
 * paragraphes, une ligne commençant par « - » fait une puce. Aucun HTML n'est
 * interprété à l'affichage. Cocher « À vérifier » affiche la mention au
 * public : c'est la façon honnête de publier une réponse pas encore confirmée.
 */
export function FaqEditor({ categories }: { categories: Categorie[] }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [edition, setEdition] = useState<string | null>(null);
  const [ajoutDans, setAjoutDans] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  async function envoyer(appel: () => Promise<{ message: string }>): Promise<boolean> {
    setErreur(null);
    try {
      const r = await appel();
      toast.success(r.message);
      router.refresh();
      return true;
    } catch (error) {
      setErreur(error instanceof ApiRequestError ? error.message : 'Enregistrement impossible.');
      return false;
    }
  }

  function champsEntree(form: HTMLFormElement) {
    const data = new FormData(form);
    return {
      categoryId: String(data.get('categoryId') ?? ''),
      question: String(data.get('question') ?? ''),
      answer: String(data.get('answer') ?? ''),
      keywords: String(data.get('keywords') ?? ''),
      position: Number(data.get('position') ?? 0),
      published: data.get('published') === 'on',
      needsReview: data.get('needsReview') === 'on',
    };
  }

  const formulaireEntree = (
    categorieId: string,
    entree: Entree | null,
    onSubmit: (event: FormEvent<HTMLFormElement>) => void,
    onCancel: () => void,
  ) => (
    <form onSubmit={onSubmit} className="space-y-3 rounded-lg border border-line bg-surface-2 p-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_200px_100px]">
        <Field label="Question" required>
          <Input name="question" defaultValue={entree?.question ?? ''} required minLength={5} maxLength={300} />
        </Field>
        <Field label="Rubrique">
          <Select name="categoryId" defaultValue={categorieId}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Ordre">
          <Input name="position" type="number" min={0} defaultValue={entree?.position ?? 0} />
        </Field>
      </div>
      <Field label="Réponse" required hint="Ligne vide : nouveau paragraphe. « - » en début de ligne : puce.">
        <Textarea name="answer" rows={7} defaultValue={entree?.answer ?? ''} required minLength={5} maxLength={8000} />
      </Field>
      <Field label="Mots-clés" hint="Mots qu'on tape sans qu'ils figurent dans la question.">
        <Input name="keywords" defaultValue={entree?.keywords ?? ''} maxLength={300} />
      </Field>
      <div className="flex flex-wrap gap-4 text-sm text-ink-2">
        <label className="flex items-center gap-2">
          <Checkbox name="published" defaultChecked={entree?.published ?? true} /> Publiée
        </label>
        <label className="flex items-center gap-2">
          <Checkbox name="needsReview" defaultChecked={entree?.needsReview ?? false} /> À vérifier
        </label>
      </div>
      <div className="flex gap-2">
        <Button type="submit">{entree ? 'Enregistrer' : 'Ajouter la question'}</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </form>
  );

  return (
    <div className="space-y-5">
      {erreur ? <Alert tone="danger">{erreur}</Alert> : null}

      {categories.map((categorie) => (
        <Card key={categorie.id}>
          <CardHeader
            title={categorie.title}
            description={`${categorie.description ?? ''} · ${categorie.entries.length} question(s) · ordre ${categorie.position}`}
            action={
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" icon={IconPlus} onClick={() => setAjoutDans(categorie.id)}>
                  Question
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={IconEdit}
                  onClick={() => setEdition(edition === `cat:${categorie.id}` ? null : `cat:${categorie.id}`)}
                >
                  Rubrique
                </Button>
              </div>
            }
          />

          {edition === `cat:${categorie.id}` ? (
            <form
              className="mb-4 grid gap-3 rounded-lg border border-line bg-surface-2 p-4 sm:grid-cols-[1fr_1fr_100px_auto]"
              onSubmit={async (event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                const fait = await envoyer(() =>
                  apiPatch(`/api/admin/faq/categories/${categorie.id}`, {
                    title: String(data.get('title')),
                    description: String(data.get('description')),
                    position: Number(data.get('position')),
                  }),
                );
                if (fait) setEdition(null);
              }}
            >
              <Field label="Titre">
                <Input name="title" defaultValue={categorie.title} required minLength={2} maxLength={120} />
              </Field>
              <Field label="Description">
                <Input name="description" defaultValue={categorie.description ?? ''} maxLength={300} />
              </Field>
              <Field label="Ordre">
                <Input name="position" type="number" min={0} defaultValue={categorie.position} />
              </Field>
              <div className="flex items-end gap-2">
                <Button type="submit">Enregistrer</Button>
                <Button
                  type="button"
                  variant="ghost"
                  icon={IconDelete}
                  disabled={categorie.entries.length > 0}
                  title={categorie.entries.length > 0 ? 'Videz d’abord la rubrique' : undefined}
                  onClick={() =>
                    confirm.ask({
                      title: 'Supprimer cette rubrique ?',
                      message: `« ${categorie.title} » sera supprimée.`,
                      confirmLabel: 'Supprimer',
                      onConfirm: async () => {
                        await envoyer(() => apiDelete(`/api/admin/faq/categories/${categorie.id}`));
                      },
                    })
                  }
                >
                  Supprimer
                </Button>
              </div>
            </form>
          ) : null}

          {ajoutDans === categorie.id
            ? formulaireEntree(
                categorie.id,
                null,
                async (event) => {
                  event.preventDefault();
                  const fait = await envoyer(() => apiPost('/api/admin/faq/entrees', champsEntree(event.currentTarget)));
                  if (fait) setAjoutDans(null);
                },
                () => setAjoutDans(null),
              )
            : null}

          <ul className="mt-3 divide-y divide-line">
            {categorie.entries.map((entree) => (
              <li key={entree.id} className="py-3">
                {edition === entree.id ? (
                  formulaireEntree(
                    categorie.id,
                    entree,
                    async (event) => {
                      event.preventDefault();
                      const fait = await envoyer(() =>
                        apiPatch(`/api/admin/faq/entrees/${entree.id}`, champsEntree(event.currentTarget)),
                      );
                      if (fait) setEdition(null);
                    },
                    () => setEdition(null),
                  )
                ) : (
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-ink">{entree.question}</p>
                      <p className="line-clamp-2 text-[13px] text-ink-3">{entree.answer}</p>
                      <span className="mt-1 flex flex-wrap gap-1">
                        {!entree.published ? <Badge tone="neutral">Non publiée</Badge> : null}
                        {entree.needsReview ? <Badge tone="amber">À vérifier</Badge> : null}
                      </span>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button size="sm" variant="ghost" icon={IconEdit} onClick={() => setEdition(entree.id)}>
                        Modifier
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={IconDelete}
                        aria-label={`Supprimer « ${entree.question} »`}
                        onClick={() =>
                          confirm.ask({
                            title: 'Supprimer cette question ?',
                            message: `« ${entree.question} » disparaîtra de la FAQ.`,
                            detail: 'Pour la retirer temporairement, décochez plutôt « Publiée ».',
                            confirmLabel: 'Supprimer',
                            onConfirm: async () => {
                              await envoyer(() => apiDelete(`/api/admin/faq/entrees/${entree.id}`));
                            },
                          })
                        }
                      />
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      ))}

      <Card>
        <CardHeader icon={IconPlus} title="Nouvelle rubrique" />
        <form
          className="grid gap-3 sm:grid-cols-[1fr_180px_1fr_100px_auto]"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            const fait = await envoyer(() =>
              apiPost('/api/admin/faq/categories', {
                title: String(data.get('title')),
                slug: String(data.get('slug')),
                description: String(data.get('description')),
                position: Number(data.get('position')),
              }),
            );
            if (fait) form.reset();
          }}
        >
          <Field label="Titre">
            <Input name="title" required minLength={2} maxLength={120} />
          </Field>
          <Field label="Identifiant" hint="minuscules-et-tirets">
            <Input name="slug" required pattern="[a-z0-9-]+" maxLength={60} />
          </Field>
          <Field label="Description">
            <Input name="description" maxLength={300} />
          </Field>
          <Field label="Ordre">
            <Input name="position" type="number" min={0} defaultValue={(categories.length + 1) * 10} />
          </Field>
          <div className="flex items-end">
            <Button type="submit" icon={IconPlus}>
              Créer
            </Button>
          </div>
        </form>
      </Card>
      <ConfirmDialog request={confirm.request} onClose={confirm.close} />
    </div>
  );
}
