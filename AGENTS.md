# Backend — règles de reprise

Lire `../ProjetContexte.md` s'il est disponible, puis README. Maintenir le contexte parent après changement significatif. Respecter NestJS, TypeScript strict et Prisma. Modèles dans prisma/schema.prisma, migrations versionnées, client généré ignoré. Ne pas utiliser db push/reset sur une base contenant des données. Aucun secret ou contenu de contact dans les logs/Git. Tester unités, HTTP et PostgreSQL de test ; garder cette base distincte de Neon. Aucun déploiement automatique sans validation.
