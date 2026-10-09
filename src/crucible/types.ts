import type { Prisma, Test, Atom, PredInstance, Predicate, PredParam, AtomSource, Relation } from "@prisma/client"

export type { Atom, AtomSource };
export type AtomSourceWithRelations = Prisma.AtomSourceGetPayload<{
  include: {
    isChildOf: true;
    fromRelations: {
      include: {
        fromAtom: {
          include: {
            isChildOf: true;
          };
        };
        toAtom: true;
      };
    };
    toRelations: {
      include: {
        fromAtom: true;
        toAtom: true;
      };
    };
  };
}>;

export type AtomWithSource = Prisma.AtomGetPayload<{
  include: {
    srcAtom: {
      include: {
        isChildOf: true;
        fromRelations: {
          include: {
            fromAtom: {
              include: {
                isChildOf: true;
              };
            };
            toAtom: true;
          };
        };
        toRelations: {
          include: {
            fromAtom: true;
            toAtom: true;
          };
        };
      };
    };
    connsFrom: true;
    connsTo: true;
  };
}>;

export type { Test };
export type TestWithCanvas = Prisma.TestGetPayload<{
  include: {
    atoms: {
      include: {
        srcAtom: {
          include: {
            isChildOf: true;
            fromRelations: {
              include: {
                fromAtom: {
                  include: {
                    isChildOf: true;
                  };
                };
                toAtom: true;
              };
            };
            toRelations: {
              include: {
                fromAtom: true;
                toAtom: true;
              };
            };
          };
        };
        connsFrom: true;
        connsTo: true;
      };
    };
    connections: {
      include: {
        from: true;
        to: true;
        connLabel: true;
      };
    }
  };
}>;

export type { PredInstance };
export type { Predicate };
export type { PredParam };
export type PredInstanceWithParams = Prisma.PredInstanceGetPayload<{
  include: {
    params: {
      include: {
        param: true;
      };
    };
    predicate: true;
  };
}>;

export type PredWithParams = Prisma.PredicateGetPayload<{
  include: {
    params: true;
  };
}>;

export type PredParamWithSource = Prisma.PredInstanceParamsGetPayload<{
  include: {
    param: true;
  };
}>;

export type { Relation };