# Disponibilités de l’équipe – Yoplait Côte d’Ivoire

Application web (Node.js + Express) avec base de données PostgreSQL.
Les employés sont regroupés **par équipe** : dès l’ouverture, l’écran « Par équipe » montre, pour chaque équipe, qui est en service, en pause ou absent. Chaque employé a son compte (numéro de téléphone + mot de passe), indique sa disponibilité, et toute l’équipe la voit (mise à jour toutes les 10 secondes). Le premier compte créé devient administrateur : il peut modifier le statut de chacun et retirer un employé.

## Déployer sur Render

1. Créez un dépôt GitHub et envoyez-y le contenu de ce dossier.
2. Sur render.com : **New > Blueprint**, choisissez le dépôt. Render lit `render.yaml` et crée la base PostgreSQL et le service web.
3. Quand Render le demande, saisissez **JOIN_CODE** : le code d’invitation à donner aux employés pour créer leur compte (sans lui, personne ne peut s’inscrire).
4. Une fois le déploiement terminé, ouvrez l’adresse du service, créez **votre** compte en premier (vous serez administrateur), puis communiquez le lien et le code à l’équipe.

Les tables se créent automatiquement au premier démarrage (`schema.sql`).

## Mot de passe oublié

- L’employé choisit « Mot de passe oublié ? » sur l’écran de connexion, puis saisit son numéro, un **code de réinitialisation** et son nouveau mot de passe.
- Le code est généré par l’administrateur : dans la « Liste », bouton **Réinit. mdp** sur la fiche de l’employé. Il est valable 30 minutes et s’annule après 5 essais ratés. L’administrateur le transmet à l’employé (appel, WhatsApp, en personne).
- Si l’**administrateur** oublie son mot de passe, il peut utiliser la clé secrète `ADMIN_RECOVERY_KEY` (définie dans Render, à garder confidentielle) à la place du code.

## Tester en local

```
npm install
DATABASE_URL=postgres://utilisateur:mdp@localhost:5432/yoplait npm start
```
Puis ouvrez http://localhost:3000.

## Bon à savoir

- Variables : `DATABASE_URL` (base), `JWT_SECRET` (généré par Render), `JOIN_CODE` (code d’invitation), `ADMIN_RECOVERY_KEY` (clé de secours de l’administrateur), `PORT` (fourni par Render).
- Le plan gratuit de Render est limité (mise en veille du service, base gratuite à durée limitée) : pour un usage réel chez Yoplait, prévoyez des plans payants et vérifiez les conditions actuelles sur render.com.
- La table `status_log` conserve l’historique des changements de statut, utile pour de futurs rapports.
