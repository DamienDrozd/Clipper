// Accès à l'API YouTube Data v3 via le paquet `googleapis`, en n'important que son module YouTube.
// Le point d'entrée « googleapis » déclare les ~340 API Google (≈ 4 millions de lignes de types) :
// la vérification TypeScript de `next build` dépasse alors 1,8 Go de mémoire et échoue sur un
// serveur modeste. Ne pas importer « googleapis » directement (règle ESLint dédiée).
export { youtube, youtube_v3 } from "googleapis/build/src/apis/youtube";
