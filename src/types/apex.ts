export interface ApexInnerClass {
  name: string;
  properties: ApexProperty[];
  methods: ApexMethod[];
}

export interface ApexMethod {
  name: string;
  returnType: string;
  parameters: ApexParameter[];
  body: string;
  annotations: string[];
  access: string;
}

export interface ApexProperty {
  name: string;
  type: string;
  access: string;
  annotations: string[];
}

export interface ApexParameter {
  name: string;
  type: string;
}

export interface ApexClassStructure {
  className: string;
  annotations: string[];
  innerClasses: ApexInnerClass[];
  methods: ApexMethod[];
  properties: ApexProperty[];
}
