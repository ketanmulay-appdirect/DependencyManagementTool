export { GradleFileParser, GradleFileModification, GradleDependency, GradleVariable } from './GradleFileParser';
export { MavenFileParser, MavenFileModification, MavenDependency, MavenProperty } from './MavenFileParser';
export { NpmFileParser, NpmFileModification, NpmDependency } from './NpmFileParser';
export { 
  FileParserService, 
  FileModification, 
  VulnerabilityFix, 
  FileParsingResult 
} from './FileParserService'; 