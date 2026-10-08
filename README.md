# Backend Gaindé Sportif

API NestJS 11, TypeScript strict, Prisma ORM 7 et PostgreSQL Neon. Semaine 1 : contact et santé du service. Ni administration, ni commandes, ni paiement à ce stade.

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
| GET     | `/api/v1/health/ready` | Base et table Prisma disponibles                      |
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

Unitaires : service de contact, environnement et signature du proxy. Intégration HTTP : validation, honeypot, headers et limitation de débit (Prisma simulé). Intégration PostgreSQL réelle : activée uniquement avec `DATABASE_TEST_URL` sur une base de test migrée, transaction annulée après vérification. Sans cette variable, ce test est explicitement ignoré.

```sh
docker run -d --name gainde-week1-test-db -e POSTGRES_USER=gainde_test -e POSTGRES_PASSWORD=local_test_only -e POSTGRES_DB=gainde_test -p 127.0.0.1:5441:5432 postgres:17-alpine
DATABASE_URL=postgresql://gainde_test:local_test_only@127.0.0.1:5441/gainde_test npm run db:migrate
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
