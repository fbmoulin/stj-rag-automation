CREATE TABLE `datasets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(255) NOT NULL,
	`title` varchar(500) NOT NULL,
	`description` text,
	`organization` varchar(255),
	`category` varchar(100),
	`totalResources` int DEFAULT 0,
	`jsonResources` int DEFAULT 0,
	`lastSyncedAt` timestamp,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `datasets_id` PRIMARY KEY(`id`),
	CONSTRAINT `datasets_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`filename` varchar(500) NOT NULL,
	`originalName` varchar(500) NOT NULL,
	`mimeType` varchar(100) NOT NULL,
	`fileSize` bigint,
	`fileUrl` text,
	`textContent` text,
	`chunkCount` int,
	`status` enum('uploaded','extracting','extracted','chunking','chunked','embedding','embedded','error') NOT NULL DEFAULT 'uploaded',
	`errorMessage` text,
	`collectionName` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `documents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `extractionLogs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`datasetSlug` varchar(255),
	`resourceId` varchar(255),
	`documentId` int,
	`action` enum('sync_datasets','download_resource','process_json','generate_embeddings','upload_document','process_document','rag_query') NOT NULL,
	`status` enum('started','completed','failed') NOT NULL DEFAULT 'started',
	`details` text,
	`recordsProcessed` int,
	`chunksGenerated` int,
	`embeddingsGenerated` int,
	`durationMs` int,
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `extractionLogs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ragQueries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`query` text NOT NULL,
	`response` text,
	`sourcesUsed` json,
	`collectionsSearched` json,
	`totalChunksRetrieved` int,
	`durationMs` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ragQueries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `resources` (
	`id` int AUTO_INCREMENT NOT NULL,
	`datasetId` int NOT NULL,
	`resourceId` varchar(255) NOT NULL,
	`name` varchar(500) NOT NULL,
	`format` varchar(50) NOT NULL,
	`url` text NOT NULL,
	`fileSize` bigint,
	`downloadedAt` timestamp,
	`processedAt` timestamp,
	`embeddedAt` timestamp,
	`recordCount` int,
	`chunkCount` int,
	`status` enum('pending','downloading','downloaded','processing','processed','embedding','embedded','error') NOT NULL DEFAULT 'pending',
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `resources_id` PRIMARY KEY(`id`),
	CONSTRAINT `resources_resourceId_unique` UNIQUE(`resourceId`)
);
