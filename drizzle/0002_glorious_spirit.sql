CREATE TABLE `communities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`communityId` int NOT NULL,
	`level` int NOT NULL DEFAULT 0,
	`parentCommunityId` int,
	`title` varchar(500),
	`summary` text,
	`fullReport` text,
	`keyEntities` json,
	`entityCount` int DEFAULT 0,
	`edgeCount` int DEFAULT 0,
	`rank` float,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `communities_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `graphEdges` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sourceEntityId` varchar(500) NOT NULL,
	`targetEntityId` varchar(500) NOT NULL,
	`relationshipType` varchar(100) NOT NULL,
	`description` text,
	`weight` float DEFAULT 1,
	`sourceRef` varchar(255),
	`mentionCount` int DEFAULT 1,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `graphEdges_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `graphNodes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` varchar(500) NOT NULL,
	`name` varchar(500) NOT NULL,
	`entityType` varchar(100) NOT NULL,
	`description` text,
	`source` varchar(50) DEFAULT 'stj',
	`sourceRef` varchar(255),
	`mentionCount` int DEFAULT 1,
	`communityId` int,
	`communityLevel` int,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `graphNodes_id` PRIMARY KEY(`id`),
	CONSTRAINT `graphNodes_entityId_unique` UNIQUE(`entityId`)
);
--> statement-breakpoint
ALTER TABLE `documents` MODIFY COLUMN `status` enum('uploaded','extracting','extracted','chunking','chunked','extracting_entities','entities_extracted','embedding','embedded','error') NOT NULL DEFAULT 'uploaded';--> statement-breakpoint
ALTER TABLE `extractionLogs` MODIFY COLUMN `action` enum('sync_datasets','download_resource','process_json','extract_entities','build_communities','generate_embeddings','upload_document','process_document','rag_query') NOT NULL;--> statement-breakpoint
ALTER TABLE `resources` MODIFY COLUMN `status` enum('pending','downloading','downloaded','processing','processed','extracting_entities','entities_extracted','embedding','embedded','error') NOT NULL DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `documents` ADD `entityCount` int;--> statement-breakpoint
ALTER TABLE `extractionLogs` ADD `entitiesExtracted` int;--> statement-breakpoint
ALTER TABLE `extractionLogs` ADD `relationshipsExtracted` int;--> statement-breakpoint
ALTER TABLE `ragQueries` ADD `queryType` varchar(20) DEFAULT 'local';--> statement-breakpoint
ALTER TABLE `ragQueries` ADD `queryEntities` json;--> statement-breakpoint
ALTER TABLE `ragQueries` ADD `communitiesUsed` json;--> statement-breakpoint
ALTER TABLE `ragQueries` ADD `totalEntitiesRetrieved` int;--> statement-breakpoint
ALTER TABLE `ragQueries` ADD `reasoningChain` text;--> statement-breakpoint
ALTER TABLE `resources` ADD `entityCount` int;--> statement-breakpoint
ALTER TABLE `resources` ADD `relationshipCount` int;--> statement-breakpoint
ALTER TABLE `ragQueries` DROP COLUMN `collectionsSearched`;