---
title: Connecteurs de catalogues
section: 3
subsection : 6
updated: 2020-12-09
description : Connecteurs de catalogues
published: true
---

Les connecteurs permettent d’interagir avec d’autres plateformes ou services de données, en lecture comme en écriture.

En écriture, l’idée est de pouvoir pousser des métadonnées dans d’autres catalogues. Un exemple de catalogue est le catalogue de données ouvertes national data.gouv.fr : les jeux de données publiés à l’aide de la solution que nous proposons peuvent être synchronisés automatiquement et toute modification dans les métadonnées est propagée vers le catalogue distant. Le fait de pousser les métadonnées plutôt que de se faire moissonner offre plusieurs avantages dont le fait de propager immédiatement les modifications.

Les connecteurs peuvent éventuellement pousser les données vers ces catalogues mais nous essayons d’éviter à cause des problèmes de duplication et synchronisation de données. Comme mentionné précédemment, la solution indexe les données de manière très performante et il est préférable de requêter les données directement à partir de celle-ci.

En ce qui concerne la lecture, l’approche est par contre différente et les connecteurs se comportent plutôt comme des moissonneurs de métadonnées et de données. On peut ainsi pour chaque connecteur paramétrer les fréquences de collecte et les types de source que l’on souhaite moissonner.

Le fait de rapatrier les données sur la plateforme permet de les indexer de manière efficace et de pouvoir centraliser les contrôles d’accès, pré-requis indispensable, si l’on souhaite pouvoir fusionner les données ou consulter différentes sources sur une visualisation.

![Catalogue de données](./images/functional-presentation/catalogues.jpg)