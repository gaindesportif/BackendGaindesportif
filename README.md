# Backend Gaindé Sportif

API NestJS 11, TypeScript strict, Prisma ORM 7 et PostgreSQL Neon. Socle contact/PWA et lot Boutique local : catalogue, comptes administrateurs et médias Cloudinary. Les commandes passent par WhatsApp ; aucun paiement ou enregistrement de commande API dans ce lot. Les migrations et tests décrits ici ne constituent pas un déploiement.

## Démarrer

Node 22.12 minimum, npm. Depuis ce dossier :

```sh
npm ci
npm run db:generate
npm run db:migrate
npm run dev
```

Créer `.env` à partir de `.env.example` sur un nouveau poste. La configuration locale fournie est déjà enregistrée et ignorée par Git. Ne jamais afficher sa valeur ni commiter une URL avec identifiants. Renouveler le mot de passe Neon partagé avant déploiement.

API locale : `http://localhost:4000/api/v1`. En mode compilé : `npm run build`, puis `npm start`. La commande `dev` utilise TypeScript avec les métadonnées nécessaires à l’injection Nest ; ne pas la remplacer par une compilation esbuild sans ces métadonnées.

## Endpoints

| Méthode | Route                  | Rôle                                                  |
| ------- | ---------------------- | ----------------------------------------------------- |
| GET     | `/api/v1/health`       | Processus vivant, sans interroger Neon                |
| GET     | `/api/v1/health/ready` | Base et tables contact/admin/boutique disponibles     |
| POST    | `/api/v1/contacts`     | Validation, consentement, enregistrement et référence |

Aucune route publique ne liste les contacts. Succès uniquement après écriture effective. Pas d’email/SMS/WhatsApp automatique. Les liens WhatsApp du frontend ouvrent une conversation, ils n’envoient pas de notification.

Le formulaire transmet une clé `Idempotency-Key` UUID : un retry identique retrouve la même référence sans nouvelle ligne. Une modification du message produit une nouvelle clé. En cas de perte réseau, l’interface parle de confirmation indisponible, sans affirmer à tort que rien n’a été enregistré.

## Prisma et migrations

- Modèles : `prisma/schema.prisma` ; client généré ignoré : `src/generated/prisma/`.
- Migration initiale versionnée : `prisma/migrations/20261008134000_init_contacts/`.
- Schéma isolé : `gainde_v1`. Les autres schémas ne sont pas gérés par cette application.
- `DATABASE_URL` : connexion applicative poolée. `DIRECT_URL` facultatif : connexion directe pour les migrations. À défaut, `prisma.config.ts` retire le suffixe Neon `-pooler` et cible `gainde_v1`.
- Développement : utiliser une branche Neon de développement ou une base locale, puis `npm run db:migrate:dev -- --name nom_du_changement`. Cette commande peut demander une base shadow : ne pas l’exécuter sur la production.
- Déploiement : `npm run db:migrate` (`prisma migrate deploy`), une fois par livraison, avant la nouvelle version. Aucune migration automatique au démarrage HTTP.
- Ne jamais utiliser `migrate reset`, `db push` ou modifier une migration déjà appliquée sur une base contenant des données. Créer une nouvelle migration.
- `npm run db:status`, `npm run db:validate`, `npm run db:studio` (outil local du développeur, jamais exposé publiquement).

## Tests

```sh
npm run check
```

Unitaires : contact, environnement, signature du proxy, hachage scrypt et transport Cloudinary simulé. Intégration HTTP : validation, honeypot, headers et limitation de débit (Prisma simulé). Intégration PostgreSQL réelle : activée uniquement avec `DATABASE_TEST_URL` sur une base locale de test migrée. Le test contact annule sa transaction ; le test Boutique crée ses propres comptes/produits synthétiques puis les supprime. DatabaseService du test Boutique reçoit explicitement l’URL de test pour ne jamais reprendre le `.env` applicatif. Sans cette variable, ce test est explicitement ignoré.

```sh
docker run -d --name gainde-week1-test-db -e POSTGRES_USER=gainde_test -e POSTGRES_PASSWORD=local_test_only -e POSTGRES_DB=gainde_test -p 127.0.0.1:5441:5432 postgres:17-alpine
DATABASE_URL=postgresql://gainde_test:local_test_only@127.0.0.1:5441/gainde_test DIRECT_URL=postgresql://gainde_test:local_test_only@127.0.0.1:5441/gainde_test npm run db:migrate
DATABASE_TEST_URL=postgresql://gainde_test:local_test_only@127.0.0.1:5441/gainde_test npm run test:integration
```

Attendre que PostgreSQL soit prêt avant la migration. Le mot de passe ci-dessus sert uniquement à une base locale jetable, pas à Neon.

`npm run test:smoke` vérifie le parcours du frontend local jusqu’à Neon : un seul contact synthétique est créé, relu puis supprimé par son identifiant exact et son marqueur de test. Exécuter seulement avec les deux serveurs locaux démarrés.

## Sécurité et exploitation

Validation stricte, honeypot, Helmet, CORS par origine exacte, limite de corps 16 Ko, timeout PostgreSQL et absence de logs contenant des contacts ou URLs de connexion.

Le formulaire est limité à 5 tentatives/minute. En local, les soumissions passant par Next partagent l’IP du serveur ; c’est une limite prudente. Avant ouverture publique, configurer `CONTACT_PROXY_SECRET` identique sur Next et Nest et le header IP réécrit par le proxy de confiance côté Next : la signature HMAC permet ensuite la limitation par visiteur. `TRUST_PROXY_HOPS` reste à 0 sauf topologie proxy vérifiée. Ne pas accepter aveuglément un header public ou exposer directement les ports Node sur Internet.

Le compteur de débit est en mémoire pour une seule instance. Prévoir stockage partagé et protection anti-bot si plusieurs instances ou trafic important. Le rôle Neon propriétaire fourni sert au développement ; créer un rôle applicatif à privilèges limités avant production, et un rôle de migration distinct.

Les overrides `deepmerge-ts` et `mysql2` corrigent les alertes de dépendances de la CLI Prisma. Vérifier génération, migrations et tests après leur évolution. L’audit de dépendances applicatives est vérifié en CI ; l’audit complet inclut aussi des alertes de l’outillage de test à surveiller.

## Déploiement futur

Dockerfile non-root fourni, port 4000. Dokploy : injecter les variables via son gestionnaire de secrets, HTTPS, réseau privé pour l’API si seul Next y accède, health check `/api/v1/health/ready`. Voir `../ProjetContexte.md` et `../FrontendGaindesportif/docs/DEPLOIEMENT.md`.

GitHub Actions effectue les contrôles et utilise un PostgreSQL temporaire. Aucun déploiement automatique configuré : le raccordement à Dokploy attend la validation locale et l’accord de publication.

## Boutique et administration — préparation locale du 19/10/2026

Migration additive `20261019170000_boutique_admin` : comptes, sessions, produits et tickets médias dans `gainde_v1`. La migration contact existante est conservée. Avant une future livraison autorisée, faire sauvegarde et migration avec le rôle dédié ; aucune migration n’est exécutée au démarrage HTTP. Ne pas appliquer la nouvelle migration sur Neon pour vérifier le code : utiliser PostgreSQL local distinct.

Le 19/10/2026, sur demande explicite de l’utilisateur, cette migration a été appliquée à la base Neon configurée via `prisma migrate deploy`, après sauvegarde privée, restauration sur PostgreSQL 18 isolé et répétition de la migration. Les deux migrations et l’intégrité des contacts ont été vérifiées. Cela ne publie pas les nouvelles applications sur le VPS et ne crée aucun compte ou produit par défaut. Suivi courant et emplacement de sauvegarde : `../ProjetContexte.md`.

### Comptes et sessions

Créer le premier propriétaire depuis un terminal interactif **sur la base expressément choisie et déjà migrée**. Sur les sources, compiler d'abord avec `npm run build` ; l'image Docker contient déjà l'outil compilé :

```sh
npm run admin:create-owner
```

L’identifiant et le nom affiché sont demandés ; le mot de passe de 12 à 128 caractères et sa confirmation sont masqués. Aucun mot de passe en argument, variable persistante ou compte par défaut. Un verrou transactionnel empêche deux créations simultanées de propriétaire. La commande refuse de créer un autre propriétaire s’il en existe un. L’absence de terminal interactif interrompt la création. Ne jamais transmettre de mot de passe dans le chat.

Les mots de passe utilisent `scrypt` asynchrone natif (sel aléatoire, N=32768, r=8, p=1). Une session opaque aléatoire de 256 bits expire après 8 heures ; seule son empreinte SHA-256 est en base. Authentification via `Authorization: Bearer` côté serveur Next. Le navigateur doit conserver uniquement le cookie HttpOnly du BFF Next, jamais le token API dans localStorage. Login limité à 5 tentatives/minute, message identique pour identifiant ou mot de passe incorrect. Un propriétaire crée uniquement des administrateurs et peut les désactiver/réinitialiser ; les sessions correspondantes sont révoquées. Le changement de son mot de passe révoque les autres sessions. Un administrateur n’a pas accès à la gestion des comptes. Les réponses admin portent `Cache-Control: no-store`.

| Méthode              | Route sous `/api/v1`                         | Réponse                                                          |
| -------------------- | -------------------------------------------- | ---------------------------------------------------------------- |
| POST                 | `/admin/auth/login`                          | `{token,expiresAt,user}`                                         |
| GET                  | `/admin/auth/me`                             | `{user}`                                                         |
| POST                 | `/admin/auth/logout`                         | 204                                                              |
| POST                 | `/admin/auth/password`                       | `{ok:true}`                                                      |
| GET / POST           | `/admin/accounts`                            | Liste `{items}` / compte créé, propriétaire uniquement           |
| PATCH                | `/admin/accounts/:id`                        | Nom, activation ou nouveau mot de passe, propriétaire uniquement |
| GET                  | `/products`                                  | `{items,total,page,pageSize}`, uniquement publiés                |
| GET                  | `/products/:slug`                            | Produit publié ou 404                                            |
| GET / POST           | `/admin/products`                            | Liste privée / nouveau brouillon                                 |
| GET / PATCH / DELETE | `/admin/products/:id`                        | Lecture, édition, suppression avec suivi                         |
| GET                  | `/admin/media/config`                        | Configuration disponible et limites                              |
| POST                 | `/admin/products/:id/media/upload-signature` | `{mediaId,uploadUrl,fields,maxBytes}`                            |
| POST                 | `/admin/products/:id/media/:mediaId/confirm` | Média vérifié et prêt                                            |
| PATCH / DELETE       | `/admin/products/:id/media/:mediaId`         | Texte alternatif/position, retrait et suppression                |

Listes : `page` (1), `pageSize` (24, maximum 100), `q`, `category`. Champs produit : `name`, `description` (texte simple, maximum 5000 caractères), `category`, `priceXof` (entier positif, nullable en brouillon), `sizes`, `colors`, `availability` (`on_request`, `available`, `unavailable`) et `status` (`draft`, `published`). Catégories : `senegal`, `dakar`, `accessoires`, `equipements`, `personnalisation`, `merchandising`. Le slug est produit côté serveur et reste stable après modification du nom. Un produit ne peut être publié qu’avec un prix positif et au moins une image prête. Le retrait de sa dernière image le remet en brouillon. Aucun prix, stock ou contenu commercial n’est préchargé.

### Cloudinary : fichiers hors VPS

Configurer les trois variables serveur de `.env.example` via les secrets du backend : `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`. Sans configuration, les brouillons restent utilisables ; demander une signature répond 503. Aucun secret Cloudinary n’est envoyé au frontend. La clé API publique et la signature temporaire sont prévues pour l’upload direct. Aucun endpoint de fichiers multipart ni stockage local sur le VPS.

Parcours : créer le brouillon, demander un ticket lié à ce produit, envoyer directement le fichier depuis le navigateur vers `uploadUrl` avec `fields`, puis appeler `/confirm`. Le backend interroge lui-même l’Admin API Cloudinary ; il contrôle publicId, type, format, dimensions, URL HTTPS et taille. Il refuse les URL/réponses upload arbitraires du client. Images JPEG/PNG/WebP/AVIF/GIF, maximum 10 Mio ; vidéos MP4/WebM/MOV/M4V, maximum 50 Mio. Cinq photos et deux vidéos maximum par produit, réservations simultanées comprises. `media/config` expose notamment `maxImages: 5`. Le frontend peut sélectionner cinq images et appelle le parcours unitaire successivement ; le verrou produit et le comptage des tickets empêchent de dépasser le quota par des demandes concurrentes. Les limites de poids sont confirmées après l’envoi direct et un fichier refusé rejoint le nettoyage durable. Aucun changement de schéma ni migration supplémentaire pour cette limite.

La suppression retire immédiatement le média ou l’annonce du catalogue. Sa file est stockée en PostgreSQL et conserve publicId/type tant que Cloudinary n’a pas confirmé la suppression. `DELETE` retourne 202 `{deleted:false,pendingMediaCleanup:n}` durant l’attente et 200 `{deleted:true,pendingMediaCleanup:0}` pour un produit purgé. Ne pas afficher un faux succès définitif après 202. Un produit en suppression ne peut plus être modifié. Le worker de l’API traite la file toutes les 30 secondes, au maximum dix tickets par passe, avec bail en base et délai exponentiel jusqu’à une heure en cas de panne. Un redémarrage ne perd pas les tickets.

Une signature Cloudinary est valable une heure et `resource_type` n’est pas signé. Le serveur impose un publicId unique et `overwrite=false`, signe les formats autorisés, supprime les namespaces image et vidéo avec `destroy` et `invalidate=true`, et purge le préfixe UUID du ticket dans le namespace raw via l’Admin API (extensions incluses). Chaque ticket reste en base pendant 65 minutes après sa création : destruction initiale dès le retrait, puis vérification/suppression après expiration afin d’éviter un upload tardif recréant un fichier abandonné. Un upload non confirmé expire au même délai. La présence en cache CDN ou sauvegarde dépend ensuite des mécanismes/délais Cloudinary ; aucun effacement universel instantané promis.

Documentation officielle suivie : [signatures](https://cloudinary.com/documentation/signatures), [upload](https://cloudinary.com/documentation/image_upload_api_reference), [publicId et types](https://cloudinary.com/documentation/upload_parameters), [suppression et préfixes](https://cloudinary.com/documentation/admin_api#delete_resources).

### Tests et limites de cette préparation

Les tests automatiques couvrent HTTP/auth/permissions, PostgreSQL local, publication, propriété des tickets, limites, confirmation, retrait, expiration, reprise après panne et suppression image/vidéo/raw, avec transport Cloudinary simulé.

Le 20/10/2026, Cloudinary a également été configuré dans le `.env` backend local privé (ignoré par Git et Docker). Recette réelle réussie avec un PNG et un WebM générés en mémoire dans Chrome, envoyés directement du navigateur vers Cloudinary et vérifiés via son Admin API par le service existant. Le retrait de la photo puis la suppression du produit ont déclenché le worker réel ; absence des deux assets confirmée par l’Admin API. File durable conservée jusqu’à expiration, puis expiration avancée uniquement dans la base PostgreSQL locale jetable de recette pour contrôler la purge finale. Aucun produit de test ajouté à Neon, aucun binaire enregistré sur le VPS et aucun média de test restant chez Cloudinary. Preuve sans identifiants : `../rapport/validation-semaine2/cloudinary-reel-20261020.json`.

Ni le VPS ni DNS `gaindesportif.com` ne sont modifiés par cette configuration locale. Renseigner les mêmes noms de variables dans le gestionnaire protégé du backend distant lors d’une livraison autorisée, avec des clés renouvelées avant production si elles ont été partagées. Le backend public existant garde sa version publiée tant qu’un déploiement distinct n’a pas été autorisé et vérifié.
