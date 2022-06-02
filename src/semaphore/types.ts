export type Project = {
    spec: ProjectSpec;
    metadata: ProjectMetadata;
};

export type ProjectSpec = {
    visibility: string;
    repository: Repository
};

export type ProjectMetadata = {
    ownerId: string;
    orgId: string;
    name: string;
    id: string;
    description: string;
};

export type Repository = {
    url: string;
    owner: string;
    name: string;
};
