# Préparation de livraison — rédaction Gaindé Media

Ce lot livre la rédaction et l’entrée Boutique. Le code de lecture publique est conservé mais bloqué par défaut, pour la semaine 2. Ce document n’atteste ni déploiement ni acceptation manager.

## Configuration et ordre de livraison

1. Effectuer une sauvegarde récente et vérifier sa restauration sur une base distincte.
2. Conserver `MEDIA_PUBLIC_ENABLED=false` dans Nest et Next. Aucun `NEXT_PUBLIC_` ne contrôle l’accès. Les routes publiques Nest `/api/v1/articles`, Next `/media`, `/media/[slug]` et `/api/media/articles…` doivent répondre 404 ; `/administration/media` reste accessible aux comptes administrateurs autorisés.
3. Appliquer avec le rôle de migration les deux migrations additives `20261113090000_editorial` et `20261113160000_editorial_featured`. Les migrations Boutique existantes restent identiques. Le lot ne contient aucune migration de paiements.
4. Vérifier les droits SELECT/INSERT/UPDATE/DELETE du rôle applicatif sur `gainde_v1.articles` et `gainde_v1.article_images`, sans lui accorder DDL ni accès à `_prisma_migrations`. Vérifier les droits SELECT du rôle de sauvegarde et la présence des deux tables dans le dump.
5. Livrer d’abord le backend, vérifier `/api/v1/health/ready` (qui contrôle aussi les tables Media), puis reconstruire et livrer le frontend avec le blocage de la semaine 2 maintenu.
6. Faire une recette authentifiée avec le compte métier existant : brouillon, photo signée directe Cloudinary, aperçu, publication interne, dépublication et retrait. Aucun compte de recette n’est créé automatiquement. Vérifier ordinateur, téléphone, clavier, panne réseau et absence de données privées dans le cache PWA.

L’auteur et le crédit photo sont facultatifs. Une photo et un texte sont requis pour publier. Titre : 160 caractères. Corps TEXT sans troncature éditoriale ; plafond technique JSON de 20 Mio. Préserver l’index SQL partiel `articles_one_published_featured` : une seule une publiée, remplacement atomique et versions concurrentes contrôlées.

## Réactivation de la semaine 2

Seulement après nouvelle décision : activer `MEDIA_PUBLIC_ENABLED=true` dans les deux services, reconstruire Next pour les liens du menu (Docker : argument MEDIA_PUBLIC_ENABLED=true et variable d’exécution true), puis refaire les contrôles publics. La publication des articles dans la rédaction ne contourne pas ce blocage. Une désactivation exige false dans les deux services et une reconstruction de Next.

## Périmètre du lot Git

Les expériences PayDunya, harnais de démonstration, raccourcis de connexion, données synthétiques, clés privées et tunnels temporaires sont exclus de ce lot. Les sources de tests automatiques restent des tests : elles ne sont pas des routes ou un amorçage de données en production. Aucune modification de domaine ni intervention VPS n’est incluse dans le push Git.

## Migration depuis le backend encore en service

Le script `scripts/migrate-media-release.mjs` est prévu pour le terminal de l’ancien backend, depuis `/app`. Il télécharge les sept migrations du commit immuable `e6c885bfa4ee9ef35c07b6fac522fbbe21b73e5d` et vérifie toutes leurs empreintes avant Prisma. Les cinq migrations historiques doivent déjà être appliquées, avec leurs empreintes attendues. Une cible différente du PostgreSQL Gaindé prévu, un historique partiel/inattendu ou des droits applicatifs de migration arrêtent la procédure.

Le mot de passe de `gainde_owner` est saisi uniquement dans le terminal masqué par le lanceur ; aucune valeur n’est intégrée au code ou aux arguments. Ne pas remplacer DATABASE_URL de l’application par le propriétaire. Après `--backup-checked` et vérification de la sauvegarde/restauration récente, l’outil applique les deux migrations Media, accorde DML au rôle applicatif et SELECT seul au rôle de sauvegarde, puis vérifie la contrainte de la une. Résultat requis : `MIGRATIONS_MEDIA_OK`. Une relance sur les sept migrations déjà appliquées vérifie les droits sans recréer les tables.

Le mode `--local-test` exige une cible loopback dont le nom contient test, avec des rôles de test séparés. Recette du 13 novembre : seize contrôles sur une base distincte, dont passage 5 → 7, donnée préexistante conservée, relance, refus d’empreinte modifiée, droits DML/lecture seule et unicité de la une. Ces tests ne prouvent pas une migration du VPS.

Après une erreur, ne pas déployer ni utiliser db push/reset ou résoudre aveuglément l’historique Prisma. Les éventuelles migrations déjà appliquées restent à diagnostiquer ; l’outil ne supprime aucune donnée pour revenir en arrière. Les octrois de droits sont transactionnels, distincts des migrations Prisma.
