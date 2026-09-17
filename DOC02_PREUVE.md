# DOC02 — Remonter à la preuve

## Route
`POST /reflection-assist`

## Appel recommandé depuis l’interface
DOC02 travaille sur un matériau précis déjà sélectionné par l’utilisateur, par exemple un résultat de DOC01.

```json
{
  "action_id": "DOC02",
  "material_id": "node:N0672"
}
```

`material_id` accepte :
- `chunk:Cxxxx`
- `node:Nxxxx`
- `relation:Rxxxx`

On peut aussi transmettre exactement un de `chunk_id`, `node_id`, `relation_id`.

## Comportement par niveau de provenance

### Niveau A
Le backend remonte aux chunks explicitement référencés dans `chunk_id_source` et restitue uniquement les extraits réellement présents dans le corpus. Les pages/timecodes sont affichés seulement s’ils existent.

### Niveau B
Le backend restitue la publication source et le repère disponible (par exemple `article web`) mais ne fabrique aucun extrait fin, numéro de page ou timecode.

### Niveau C
Le backend restitue la publication source et signale explicitement que le repérage fin est indisponible. Aucun extrait, numéro de page ou timecode n’est inventé.

## Principe
DOC02 ne recherche pas une preuve « plausible » : il suit uniquement la provenance déjà enregistrée pour le matériau sélectionné.
