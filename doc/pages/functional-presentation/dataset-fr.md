---
title: Clés d’API
section: 3
subsection : 2
updated: 2020-12-09
description : Clés d’API
published: true
---


Les jeux de données sont représentés sous formes de fiches sur la plateforme. Une fiche possède un titre et des informations relatives aux données.


![Catalogue de données](./images/functional-presentation/jeux-2.jpg)

Les informations d’une fiche comprennent le nom du fichier, sa taille, le nombre de lignes et les thématiques des données. L'icône du propriétaire des données et l’état de publication sont aussi disponibles sur chaque fiche.

On peut rapidement ajouter un jeu de données à l’aide de différents boutons d’ajout.

### Types de données

Il existe plusieurs types de jeux de données sur la plateforme, les fichiers, les jeux de données incrémentaux, les jeux de données virtuels.

* Les fichiers

Les fichiers correspondent à des données sous formats tabulaires ou cartographiques. La plateforme permet d’indexer plusieurs formats de fichiers tels que le CSV, TSV, XLS, TXT,GeoJson, KML, ESRI Shapefile, …

* Les jeux de données incrémentaux

Les jeux de données incrémentaux sont des données stockées dans des bases distantes. Ils sont mis à jour par API et correspondent parfaitement au besoin des données IOT.

* Les jeux de données virtuels

Les jeux de données virtuels correspondent à des vues d’un ou plusieurs jeux de données. Ils permettent d’avoir un contrôle d’accès plus poussé. Ils peuvent par exemple servir à créer une vue publique, restreinte à certaines lignes et certaines colonnes, d’un jeu de données plus complet qui reste privé.

### Edition d’un jeu de données

La page d’édition d’un jeu de données permet de travailler la présentation et la réutilisabilité de ce jeu. Cette page va nous permettre de modifier le titre du jeu de données, mettre à jour les données, compléter le schéma des données, sémantiser les données pour qu'elles soient réutilisables dans des visualisations ou pour enrichir les données via des services complémentaires.

À la création du jeu de données il est soumis à ces 6 étapes de traitement (les 2 premières uniquement dans le cas d’un jeu de données de type fichier). En cas de modification apportée par la suite seules les étapes nécessaires sont rejouées :

1. Le chargement, représenté par la barre de progression.
2. La conversion vers un format utilisé par la plateforme en interne.
3. L'analyse, qui va déterminer le schéma du jeu de données.
4. L’enrichissement, qui va parcourir les lignes et ajouter des colonnes en fonction des extensions demandées.
5. L'indexation, qui va permettre d’exploiter les données du fichier.
6. La finalisation, qui correspond aux derniers traitements avant que le jeu de données ne soit disponible.

Lorsque la finalisation est terminée, le jeu de données passe en état "disponible". Il peut alors être de nouveau édité, enrichi ou utilisé dans vos visualisations.

### Schéma des données

La page d'édition d'un jeu de données permet de renseigner les concepts dans la section Schéma des données.  
Les concepts sont des notions connues pour la plateforme. Ils permettent d'augmenter la réutilisabilité de vos données et de faire le lien entre vos données et les fonctionnalités de la plateforme.

![Catalogue de données](./images/functional-presentation/schema.jpg)


A l’aide des concepts, vous pouvez par exemple enrichir vos données pour leur donner encore plus de valeur ou bien projeter vos données sur une carte.
Un concept est unique à une colonne d'un jeu de données. Vous ne pouvez pas avoir deux colonnes différentes avec le même concept pour un jeu de données.
Les concepts sont nécessaires à la représentation de certaines visualisations. Par exemple, vos données ne pourront pas être projetées sur une carte si vous n'avez pas associé les concepts *Latitude* et *Longitude* aux colonnes qui contiennent les valeurs latitude et longitude.

Dans la section des Schéma de données, on peut renseigner des libellés sur chacun des champs. Ces libellés seront ensuite utilisés dans les différentes visualisations qui utilisent ce jeu de données

### Enrichissement des données

La solution proposée permet de croiser vos données avec des données issues de l'open data telles que la base SIRENE, le cadastre, les données INSEE et la BAN.  
* La base SIRENE rassemble les informations économiques et juridiques de plus de 28 Millions d'établissements d'entreprises, dont plus de 11 Millions actifs.
* Le cadastre permet d'avoir accès aux différentes informations concernant les parcelles. Vous pouvez notamment géocoder des codes parcelles ou encore obtenir les surfaces de vos parcelles.
* Les données INSEE permettent de récupérer diverses informations sur les divisions administrative (communes, départements, régions)
* La BAN est la Base d'Adresse Nationale. Elle permet de géolocaliser des adresses ou de trouver des adresses à partir de coordonnées.

En fonction des données que vous possédez, vous pouvez choisir l'enrichissement qui vous convient et ainsi donner plus de valeur à vos données.

### Permissions de partage de données

Un administrateur peut contrôler les permissions d’accès. En fonction du rôle attribué à un utilisateur, celui-ci à le droit d'accéder, de lire ou/et de modifier le contenu de la source.

![Catalogue de données](./images/functional-presentation/permissions.jpg)

On peut ainsi donner le rôle d’*user* à un groupe de personnes et définir s’ils peuvent accéder et lire une ressource de la plateforme.

Il est aussi possible d'attribuer des permissions plus finement et d’autoriser l’écriture à certains jeux de données pour un utilisateur ou un rôle en particulier.

### Journal du jeu de données

Le journal d’un jeu de données permet de vérifier l’historique des modifications sur le jeu de données.  
Le journal permet la traçabilité des chargement des jeux de données (type de modification, par qui, quand), des paramètres (type de modification, par qui, quand) et des habilitations (type de modification, par qui, quand).

![Catalogue de données](./images/functional-presentation/journal.jpg)


Un journal global pour la suppression des jeux de données peut être réalisable.

### Pièces jointes

Il est possible d’associer des pièces jointes à chaque ligne d’un jeu de données. Cela se fait en associant une archive au format zip qui contient les fichiers à associer. Il faut aussi qu’il y ait dans le jeu de données une colonne contenant les noms des fichiers à associer à chaque ligne. Deux types de fichiers peuvent être liés aux lignes : des images (png, jpg, …) ou des documents (pdf, docx, xlsx, …). Dans le cas où ce sont des documents qui sont liés aux lignes, ils sont indexés par la plateforme de sorte que les lignes puissent être filtrées avec des recherches fulltext portant sur des éléments contenus dans les documents.

Les pièces jointes peuvent aussi être directement attachées à un jeu de données et ainsi ajouter des fichiers de documentation ou des métadonnées riches.